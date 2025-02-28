const YAML = require('yamljs')
const fs = require('fs')
const os = require('os')
const path = require('path')
const _ = require('lodash')
const { alphanumeric } = require('nanoid-dictionary')

const { findAvailablePorts } = require('../utils/port')
const { safeExecSync } = require('../utils/shell')
const dataFile = require('../utils/data')

const tempFolder = path.resolve(process.env.META_TEMP_FOLDER || os.tmpdir())
const data = dataFile.read()
const processes = _.get(data, 'processes', {})

const folder = path.resolve(process.env.META_FOLDER || __dirname)
const bin = path.join(folder, 'http-meta')
const tpl = path.join(folder, 'tpl.yaml')

let maxAvailablePort = parseInt(process.env.META_MAX_AVAILABLE_PORT)
// 65535 is available
// fixed: https://github.com/MetaCubeX/mihomo/commit/05e8f13a8d65e287a7c050219342950dd8e015b4
// We're not short of one port. Let's leave it as it is for now.
maxAvailablePort =
  !isNaN(maxAvailablePort) && maxAvailablePort >= 1 && maxAvailablePort <= 65534 ? maxAvailablePort : 65534

let minAvailablePort = parseInt(process.env.META_MIN_AVAILABLE_PORT)
minAvailablePort = !isNaN(minAvailablePort) && minAvailablePort >= 1 && minAvailablePort <= 65534 ? minAvailablePort : 1

console.log(`[META AVAILABLE PORT] ${minAvailablePort}-${maxAvailablePort}`)
if (minAvailablePort > maxAvailablePort) {
  console.log(`minAvailablePort > maxAvailablePort`)
  process.exit(1)
}

let disableAutoClean = process.env.META_DISABLE_AUTO_CLEAN
try {
  disableAutoClean = JSON.parse(disableAutoClean)
} catch (e) {}
console.log(`[DISABLE AUTO CLEAN] ${disableAutoClean ? 'true' : 'false'}`)
try {
  fs.accessSync(folder)
  console.log(`[META FOLDER] ${folder}`)
} catch (e) {
  console.log(
    `Meta folder "${folder}" does not exist. This can be customized using the environment variable "META_FOLDER"`
  )
  process.exit(1)
}
try {
  fs.accessSync(tempFolder)
  console.log(`[META TEMP FOLDER] ${tempFolder}`)
} catch (e) {
  console.log(
    `Meta temp folder "${tempFolder}" does not exist. This can be customized using the environment variable "META_TEMP_FOLDER"`
  )
  process.exit(1)
}
try {
  fs.accessSync(bin)
  console.log(`[META CORE] ${bin}`)
} catch (e) {
  console.log(`Meta Core "${bin}" does not exist`)
  process.exit(1)
}
try {
  fs.accessSync(tpl)
  console.log(`[META CONFIG TEMPLATE] ${tpl}`)
} catch (e) {
  console.log(`Meta Config Template "${tpl}" does not exist`)
  process.exit(1)
}

module.exports = {
  start,
  stop,
  restart,
  getPID,
  getStats,
  startCheck,
  test,
}

async function restart(input) {
  await stop()
  const info = await start(input)
  return info
}
async function start(input) {
  const { customAlphabet } = await import('nanoid')

  const id = customAlphabet(alphanumeric)()
  const config = path.join(tempFolder, `http-meta.${id}.yaml`)
  const log = path.join(tempFolder, `http-meta.${id}.log`)

  const info = await genConfig(input, config)

  safeExecSync(`chmod a+x ${bin}`)

  let pid = safeExecSync(`${bin} -d ${folder} -f ${config} > ${log} 2>&1 &\necho $!`).trim()

  if (pid) {
    pid = _.toInteger(pid)
    info.pid = pid
    info.config = config
    info.log = log
    processes[pid] = {
      startTime: Date.now(),
      timeout: input.timeout || 30 * 60 * 1000,
      ...info,
    }
    dataFile.write({ ...data, processes })

    console.log(`[META] STARTED\n[PID] ${pid}\n[CONFIG] ${config}\n[LOG] ${log}\n`)
  }

  return info
}
async function stop(_pid) {
  let pid
  if (_.isArray(_pid) ? !_.isEmpty(_pid) : _pid) {
    let _pids = _.isArray(_pid) ? _pid : [_pid]
    pid = []
    _.map(_pids, i => {
      const config = _.get(processes, `${i}.config`)
      const log = _.get(processes, `${i}.log`)

      if (config) {
        disableAutoClean || safeExecSync(`rm -f ${config}`)
      }
      if (log) {
        disableAutoClean || safeExecSync(`rm -f ${log}`)
      }

      safeExecSync(`kill -9 ${i}`)

      const stdout = safeExecSync(`ps -p ${i}`)
        .trim()
        .split(/[\r\n]+/)
        .map(i => i.trim())
        .filter(i => i.length)

      if (_.chain(stdout).get(1).startsWith(`${i}`).value()) {
        pid.push(i)
      } else {
        console.log(`[META] STOPPED\n[PID] ${i}\n[CONFIG] ${config}\n[LOG] ${log}\n`)
        delete processes[i]
        dataFile.write({ ...data, processes })
      }
    })
  } else {
    disableAutoClean || safeExecSync(`rm -f ${path.join(tempFolder, `http-meta.*.log`)}`)
    disableAutoClean || safeExecSync(`rm -f ${path.join(tempFolder, `http-meta.*.yaml`)}`)
    safeExecSync(`pkill http-meta`)
    pid = await getPID()
    if (!_.isEmpty(pid)) {
      _.map(pid, i => {
        safeExecSync(`kill -9 ${i}`)
      })
    }
    pid = await getPID()
  }
  if (!_.isEmpty(pid)) {
    throw new Error(`Cannot stop PID: ${pid}`)
  }
  return { pid }
}
async function getPID(_pid) {
  let pid = safeExecSync(`pgrep http-meta`).trim()

  pid = pid
    ? _.chain(pid)
        .split(/[\r\n]+/)
        .map(i => i.trim())
        .filter(i => i.length)
        .map(i => _.toInteger(i))
        .value()
    : null
  if (!_.isEmpty(_pid)) {
    let _pids = _.isArray(_pid) ? _pid : [_pid]
    _pids = _.map(_pids, i => _.toInteger(i))
    return _.intersection(pid, _pids)
  }
  return pid
}
async function genConfig(input, config) {
  let proxies = _.get(input, 'proxies')
  if (!_.isArray(proxies) || _.isEmpty(proxies)) {
    try {
      proxies = _.get(YAML.parse(proxies), 'proxies')
    } catch (e) {}
  }
  if (!_.isArray(proxies) || _.isEmpty(proxies)) {
    try {
      proxies = _.get(YAML.parse(input), 'proxies')
    } catch (e) {}
  }
  if (!_.isArray(proxies) || _.isEmpty(proxies)) {
    throw new Error(`empty proxies`)
  }
  // const [port, ...ports] = await findAvailablePorts(65535, 1, proxies.length + 1)
  const processesPorts = Object.values(processes).reduce((ports, process) => {
    return ports.concat(process.ports)
  }, [])

  const ports = await findAvailablePorts(maxAvailablePort, minAvailablePort, proxies.length, processesPorts)

  const yaml = YAML.parse(fs.readFileSync(tpl, 'utf8'))

  // yaml['bind-address'] = `0.0.0.0`
  // yaml['external-controller'] = `${yaml['bind-address']}:${port}`

  yaml.proxies = _.map(proxies, (p, index) => {
    return { ...p, name: `proxy-${index}` }
  })

  yaml.listeners = _.map(yaml.proxies, (p, index) => {
    return {
      name: `listener-${p.name}`,
      type: 'mixed',
      port: ports[index],
      listen: yaml['bind-address'],
      proxy: `${p.name}`,
      udp: true,
    }
  })
  yaml['proxy-groups'] = [
    {
      name: 'proxy',
      type: 'select',
      proxies: _.map(yaml.proxies, 'name'),
    },
  ]

  fs.writeFileSync(config, YAML.stringify(yaml), 'utf8')

  return {
    ports,
    // port,
  }
}

function getStats(pid) {
  const command = `ps -p ${pid} -o rss,pcpu`

  const output = safeExecSync(command)
  const lines = output.trim().split('\n')
  const values = lines[1].trim().split(/\s+/)
  const mem = _.toNumber(values[0])
  const cpu = _.toNumber(values[1])
  return {
    ports: _.get(processes, `${pid}.ports`),
    mem,
    cpu,
    err: _.get(processes, `${pid}.err`),
  }
}
async function test() {
  let log
  let config
  let error
  let _pid
  try {
    const {
      pid,
      log: logFile,
      config: configFile,
    } = await start({
      timeout: 60 * 60 * 1000,
      proxies: [{ name: 'test', type: 'http', server: '127.0.0.1', port: 80 }],
    })
    await new Promise(r => setTimeout(r, 2 * 1000))
    _pid = _.get(await getPID(pid), 0)
    try {
      log = fs.readFileSync(logFile, 'utf8')
    } catch (e) {}
    try {
      config = fs.readFileSync(configFile, 'utf8')
    } catch (e) {}
    try {
      await stop(pid)
    } catch (e) {}
  } catch (e) {
    error = _.get(e, 'message') || String(e)
    console.error(`[META] TEST ERROR`, e)
    try {
      log = fs.readFileSync(logFile, 'utf8')
    } catch (e) {}
    try {
      config = fs.readFileSync(configFile, 'utf8')
    } catch (e) {}
  }
  return { error, pid: _pid, log, config }
}

function startCheck() {
  setInterval(async () => {
    let pids = (await getPID()) || []
    _.map(processes, (v, k) => {
      if (!_.includes(pids, _.toInteger(k))) {
        console.log(`[INTERVAL] remove PID ${k}`)
        delete processes[k]
      }
    })
    dataFile.write({ ...data, processes })

    if (!_.isEmpty(pids)) {
      console.log(`[INTERVAL] check PID: ${pids}`)
      for (const pid of pids) {
        const process = processes[pid]
        if (process) {
          let { startTime, timeout } = process
          if (Date.now() - startTime >= timeout) {
            console.log(
              `[INTERVAL] kill PID ${pid}, ${_.round((Date.now() - startTime) / 1000 / 60, 2)}m >= ${_.round(
                timeout / 1000 / 60,
                2
              )}m`
            )
            try {
              await stop(pid)
            } catch (e) {
              console.error(e)
              processes[pid].err = e
              dataFile.write({ ...data, processes })
            }
          }
        } else {
          console.log(`[INTERVAL] unrecorded PID ${pid}`)
          processes[pid] = {
            startTime: Date.now(),
            timeout: 30 * 60 * 1000,
          }
        }
      }
    }
  }, 60 * 1000)
}
