const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { setTimeout: delay } = require('node:timers/promises')
const YAML = require('yamljs')
const _ = require('lodash')
const { alphanumeric } = require('nanoid-dictionary')

const { validateRuntime } = require('./runtime')

function createManager(options) {
  const fileSystem = options.fs || fs
  const dataFile = options.dataFile
  const tempFolder = options.tempFolder
  const folder = options.folder
  const tpl = options.tpl
  const findPorts = options.findPorts
  const disableAutoClean = options.disableAutoClean
  const maxAvailablePort = options.maxAvailablePort || 65534
  const minAvailablePort = options.minAvailablePort || 1
  const createPID = options.createPID || (() => crypto.randomInt(1, 0x7fffffff))
  const runtimes = new Map()
  let activeRuntime = options.activeRuntime
  let checkTimer
  let checkInFlight = false

  for (const runtime of options.runtimes || []) registerRuntime(runtime)
  if (!activeRuntime && runtimes.size) activeRuntime = runtimes.keys().next().value
  if (!runtimes.has(activeRuntime)) throw new Error(`Mihomo runtime "${activeRuntime}" is not registered`)

  const data = dataFile.read()
  const storedInstances = _.isPlainObject(data.instances)
    ? data.instances
    : _.isPlainObject(data.processes)
      ? data.processes
      : {}
  const instances = Object.fromEntries(
    Object.entries(storedInstances).map(([key, record]) => {
      const pid = isPID(record.pid) ? record.pid : Number(key)
      if (!isPID(pid)) throw new Error(`Invalid persisted compatibility PID: ${key}`)
      const { id, pid: storedPID, ...values } = record
      return [String(pid), { ...values, runtimeId: record.runtimeId ?? id ?? storedPID ?? pid }]
    })
  )
  delete data.processes

  return {
    start,
    stop,
    restart,
    list,
    stats,
    startCheck,
    stopCheck,
    test,
    registerRuntime,
    useRuntime,
  }

  function registerRuntime(runtime) {
    runtime = validateRuntime(runtime)
    runtimes.set(runtime.name, runtime)
    return runtime
  }

  function useRuntime(name) {
    if (!runtimes.has(name)) throw new Error(`Mihomo runtime "${name}" is not registered`)
    activeRuntime = name
  }

  async function restart(input) {
    await stop()
    return start(input)
  }

  async function start(input) {
    const { customAlphabet } = await import('nanoid')
    const suffix = customAlphabet(alphanumeric)()
    const config = path.join(tempFolder, `http-meta.${suffix}.yaml`)
    const log = path.join(tempFolder, `http-meta.${suffix}.log`)
    const runtime = runtimes.get(activeRuntime)

    const info = await genConfig(input, config)
    try {
      const result = await runtime.launch({
        config,
        configText: fileSystem.readFileSync(config, 'utf8'),
        folder,
        input,
        log,
        tempFolder,
      })
      const { runtimeId, pid } = normalizeRuntimeHandle(result, runtime.name)

      info.instanceId = pid
      info.config = config
      info.log = log
      instances[String(pid)] = {
        runtimeId,
        runtime: runtime.name,
        startTime: Date.now(),
        timeout: input.timeout || 30 * 60 * 1000,
        ports: info.ports,
        config,
        log,
      }
      persist()

      console.log(`[META] STARTED\n[PID] ${pid}\n[CONFIG] ${config}\n[LOG] ${log}\n`)
      return info
    } catch (error) {
      if (!disableAutoClean) {
        removeFile(config)
        removeFile(log)
      }
      throw error
    }
  }

  async function stop(requested) {
    await discoverIfNeeded(requested)
    const selected = selectRecords(requested)
    const remaining = []

    for (const [key, record] of selected) {
      const runtime = runtimeFor(record)
      const id = record.runtimeId
      const pid = Number(key)
      try {
        await runtime.terminate(id, record)
      } catch (error) {
        if (await runtime.isActive(id, record)) {
          remaining.push(pid)
          record.err = serializeError(error)
          continue
        }
      }

      if (await waitForExit(runtime, id, record)) {
        remaining.push(pid)
        continue
      }

      if (!disableAutoClean) {
        removeFile(record.config)
        removeFile(record.log)
      }
      console.log(`[META] STOPPED\n[PID] ${pid}\n[CONFIG] ${record.config}\n[LOG] ${record.log}\n`)
      delete instances[key]
    }

    if (requested === undefined || requested === null || requested === '') {
      if (!disableAutoClean) cleanGeneratedFiles()
    }
    persist()
    if (remaining.length) throw new Error(`Cannot stop PID: ${remaining.join(',')}`)
    return { instanceIds: [] }
  }

  async function list(requested) {
    await discoverIfNeeded(requested)
    const selected = selectRecords(requested)
    const alive = []
    for (const [key, record] of selected) {
      const runtime = runtimeFor(record)
      if (await runtime.isActive(record.runtimeId, record)) alive.push(Number(key))
    }
    return alive
  }

  async function stats(id) {
    if (!instances[String(id)]) await discoverActiveRuntime()
    const entry = instances[String(id)]
    if (!entry) return { ports: undefined, err: undefined }
    const runtime = runtimeFor(entry)
    const values = runtime.readStats ? await runtime.readStats(entry.runtimeId, entry) : {}
    return {
      ports: entry.ports,
      memoryBytes: values && values.memoryBytes,
      cpuPercent: values && values.cpuPercent,
      err: entry.err,
    }
  }

  async function waitForExit(runtime, id, record, timeout = 3000, interval = 50) {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      if (!(await runtime.isActive(id, record))) return false
      await delay(interval)
    }
    return runtime.isActive(id, record)
  }

  async function genConfig(input, config) {
    let cfg = input
    let proxies = _.get(cfg, 'proxies')
    if (!_.isArray(proxies) || _.isEmpty(proxies)) {
      try {
        proxies = _.get(YAML.parse(proxies), 'proxies')
      } catch (error) {}
    }
    if (!_.isArray(proxies) || _.isEmpty(proxies)) {
      try {
        const parsed = YAML.parse(cfg)
        if (parsed && typeof parsed === 'object') {
          proxies = _.get(parsed, 'proxies')
          if (_.isArray(proxies) && !_.isEmpty(proxies)) cfg = parsed
        }
      } catch (error) {}
    }
    if (!_.isArray(proxies) || _.isEmpty(proxies)) throw new Error('empty proxies')

    const usedPorts = Object.values(instances).flatMap(instance => instance.ports || [])
    const ports = await findPorts(maxAvailablePort, minAvailablePort, proxies.length, usedPorts)
    const yaml = YAML.parse(fileSystem.readFileSync(tpl, 'utf8'))

    if (cfg && typeof cfg === 'object') {
      if (_.isPlainObject(cfg.dns)) yaml.dns = cfg.dns
      if (_.isPlainObject(cfg.hosts)) yaml.hosts = cfg.hosts
    }
    yaml.proxies = _.map(proxies, (proxy, index) => ({ ...proxy, name: `proxy-${index}` }))
    yaml.listeners = _.map(yaml.proxies, (proxy, index) => ({
      name: `listener-${proxy.name}`,
      type: 'mixed',
      port: ports[index],
      listen: yaml['bind-address'],
      proxy: proxy.name,
      udp: true,
    }))
    yaml['proxy-groups'] = [
      {
        name: 'proxy',
        type: 'select',
        proxies: _.map(yaml.proxies, 'name'),
      },
    ]
    fileSystem.writeFileSync(config, YAML.stringify(yaml), 'utf8')
    return { ports }
  }

  async function test() {
    let log
    let config
    let error
    let id
    let logFile
    let configFile
    try {
      const info = await start({
        timeout: 60 * 60 * 1000,
        proxies: [{ name: 'test', type: 'http', server: '127.0.0.1', port: 80 }],
      })
      id = info.instanceId
      logFile = info.log
      configFile = info.config
      await delay(2 * 1000)
      id = (await list(id))[0]
      log = readFile(logFile)
      config = readFile(configFile)
      try {
        await stop(info.instanceId)
      } catch (stopError) {}
    } catch (cause) {
      error = _.get(cause, 'message') || String(cause)
      console.error('[META] TEST ERROR', cause)
      log = readFile(logFile)
      config = readFile(configFile)
    }
    return { error, instanceId: id, log, config }
  }

  function startCheck() {
    if (checkTimer) return checkTimer
    checkTimer = setInterval(async () => {
      if (checkInFlight) return
      checkInFlight = true
      let changed = false
      try {
        const alive = new Set((await list()).map(String))
        for (const [key, record] of Object.entries(instances)) {
          const pid = Number(key)
          if (!alive.has(String(pid))) {
            console.log(`[INTERVAL] remove PID ${pid}`)
            if (!disableAutoClean) {
              removeFile(record.config)
              removeFile(record.log)
            }
            delete instances[key]
            changed = true
            continue
          }

          const startTime = record.startTime
          const timeout = record.timeout
          if (Date.now() - startTime >= timeout) {
            console.log(
              `[INTERVAL] kill PID ${pid}, ${_.round((Date.now() - startTime) / 1000 / 60, 2)}m >= ${_.round(
                timeout / 1000 / 60,
                2
              )}m`
            )
            try {
              await stop(pid)
            } catch (cause) {
              console.error(cause)
              record.err = serializeError(cause)
              changed = true
            }
          }
        }
        if (changed) persist()
      } catch (error) {
        console.error('[INTERVAL] check failed', error)
      } finally {
        checkInFlight = false
      }
    }, 60 * 1000)
    return checkTimer
  }

  function stopCheck() {
    if (!checkTimer) return
    clearInterval(checkTimer)
    checkTimer = undefined
  }

  function selectRecords(requested) {
    if (requested === undefined || requested === null || requested === '') return Object.entries(instances)
    const ids = Array.isArray(requested) ? requested : [requested]
    return ids.flatMap(id => {
      const key = String(id)
      return instances[key] ? [[key, instances[key]]] : []
    })
  }

  function runtimeFor(record) {
    const name = record.runtime || 'executable'
    const runtime = runtimes.get(name)
    if (!runtime) throw new Error(`Mihomo runtime "${name}" is not registered`)
    return runtime
  }

  async function discoverActiveRuntime() {
    const runtime = runtimes.get(activeRuntime)
    if (!runtime.discover) return

    let changed = false
    for (const result of (await runtime.discover()) || []) {
      const { runtimeId, pid } = normalizeRuntimeHandle(result, runtime.name, true)
      if (instances[String(pid)]) continue
      instances[String(pid)] = {
        runtimeId,
        runtime: runtime.name,
        startTime: Date.now(),
        timeout: 30 * 60 * 1000,
      }
      changed = true
    }
    if (changed) persist()
  }

  function discoverIfNeeded(requested) {
    if (requested === undefined || requested === null || requested === '') return discoverActiveRuntime()
    const ids = Array.isArray(requested) ? requested : [requested]
    return ids.some(id => !instances[String(id)]) ? discoverActiveRuntime() : undefined
  }

  function normalizeRuntimeHandle(result, runtimeName, discovered = false) {
    const handle = result && typeof result === 'object' ? result : { id: result }
    const runtimeId = handle.id === undefined ? handle.pid : handle.id
    if (runtimeId === undefined || runtimeId === null || runtimeId === '') {
      throw new Error(`Mihomo runtime "${runtimeName}" did not return an instance id`)
    }
    const pid = isPID(handle.pid) ? handle.pid : discovered && isPID(runtimeId) ? runtimeId : allocatePID()
    return { runtimeId, pid }
  }

  function allocatePID() {
    let pid
    do {
      pid = createPID()
      if (!isPID(pid)) throw new Error(`Invalid generated compatibility PID: ${pid}`)
    } while (instances[String(pid)])
    return pid
  }

  function isPID(value) {
    return Number.isSafeInteger(value) && value > 0
  }

  function cleanGeneratedFiles() {
    for (const name of fileSystem.readdirSync(tempFolder)) {
      if (/^http-meta\..+\.(?:log|yaml)$/.test(name)) removeFile(path.join(tempFolder, name))
    }
  }

  function removeFile(file) {
    if (!file) return
    try {
      fileSystem.rmSync(file, { force: true })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  function readFile(file) {
    if (!file) return undefined
    try {
      return fileSystem.readFileSync(file, 'utf8')
    } catch (error) {
      return undefined
    }
  }

  function serializeError(error) {
    return { message: _.get(error, 'message') || String(error) }
  }

  function persist() {
    dataFile.write({ ...data, instances })
  }
}

module.exports = {
  createManager,
}
