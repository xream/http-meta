const YAML = require('yamljs')
const fs = require('fs')
const os = require('os')
const path = require('path')
const _ = require('lodash')
const { alphanumeric } = require('nanoid-dictionary')

const { findAvailablePorts } = require('../utils/port')
const { safeExecSync } = require('../utils/shell')
const dataFile = require('../utils/data')

const data = dataFile.read()
const processes = _.get(data, 'processes', {})

const folder = path.resolve(process.env.META_FOLDER || __dirname)
const bin = path.join(folder, 'http-meta')
const tpl = path.join(folder, 'tpl.yaml')

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
}

async function restart(input) {
  await stop()
  const info = await start(input)
  return info
}
async function start(input) {
  const { customAlphabet } = await import('nanoid')

  const id = customAlphabet(alphanumeric)()
  const config = path.join(os.tmpdir(), `http-meta.${id}.yaml`)
  const log = path.join(os.tmpdir(), `http-meta.${id}.log`)

  const info = await genConfig(input, config)

  safeExecSync(`chmod a+x ${bin}`)

  let pid = safeExecSync(`${bin} -d ${folder} -f ${config} > ${log} 2>&1 &\necho $!`).trim()

  if (pid) {
    pid = _.toInteger(pid)
    info.pid = pid
    processes[pid] = {
      config,
      log,
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
        safeExecSync(`rm -f ${config}`)
      }
      if (log) {
        safeExecSync(`rm -f ${log}`)
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
    safeExecSync(`rm -f ${path.join(os.tmpdir(), `http-meta.*.log`)}`)
    safeExecSync(`rm -f ${path.join(os.tmpdir(), `http-meta.*.yaml`)}`)
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

  const ports = await findAvailablePorts(65535, 1, proxies.length, processesPorts)

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
