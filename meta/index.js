const YAML = require('yamljs')
const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const { findAvailablePorts } = require('../utils/port')
const { safeExecSync } = require('../utils/shell')

const processes = {}

const folder = __dirname
const bin = path.join(folder, 'http-meta')
const tpl = path.join(folder, 'tpl.yaml')
const config = path.join(folder, 'config.yaml')
const log = path.join(folder, 'http-meta.log')

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
  safeExecSync(`rm -f ${config}`)
  safeExecSync(`mv ${log} ${log}.old > /dev/null 2>&1`)

  const info = await genConfig(input)

  safeExecSync(`chmod a+x ${bin}`)

  let pid = safeExecSync(`${bin} -d ${folder} -f ${config} > ${log} 2>&1 &\necho $!`).trim()
  console.log(`pid`, pid)
  if (pid) {
    pid = _.toInteger(pid)

    processes[pid] = {
      startTime: new Date(),
      timeout: input.timeout || 30 * 60 * 1000,
    }

    info.pid = pid
  }

  return info
}
async function stop(_pid) {
  let pid
  if (!_.isEmpty(_pid)) {
    let _pids = _.isArray(_pid) ? _pid : [_pid]
    pid = []
    _.map(_pids, i => {
      safeExecSync(`kill -9 ${i}`)
      const stdout = safeExecSync(`ps -p ${i}`)
        .trim()
        .split(/[\r\n]+/)
        .map(i => i.trim())
        .filter(i => i.length)

      if (_.chain(stdout).get(1).startsWith(`${i}`).value()) {
        pid.push(i)
      }
    })
  } else {
    safeExecSync(`pkill http-meta`)
    pid = await getPID()
    if (pid) {
      safeExecSync(`kill -9 ${pid}`)
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
async function genConfig(input) {
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
  const ports = await findAvailablePorts(65535, 1, proxies.length)

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
    mem,
    cpu,
    err: _.get(processes, `${pid}.err`),
  }
}
function startCheck() {
  setInterval(async () => {
    for (const pid of Object.keys(processes)) {
      let { startTime, timeout, notExistCount = 0 } = processes[pid]

      const _pid = await getPID(pid)
      if (_.isEmpty(_pid)) {
        notExistCount += 1
        if (notExistCount > 2) {
          console.log(`PID ${pid} is not exist, delete it`, notExistCount)
          delete processes[pid]
        } else {
          console.log(`PID ${pid} is not exist`, notExistCount)
          processes[pid].notExistCount = notExistCount
        }
      } else {
        if (new Date() - startTime >= timeout) {
          console.log(
            `stop PID ${pid}, ${_.round((new Date() - startTime) / 1000 / 60, 2)}m >= ${_.round(
              timeout / 1000 / 60,
              2
            )}m`
          )
          try {
            await stop(pid)
            delete processes[pid]
          } catch (e) {
            console.error(e)
            processes[pid].err = e
          }
        }
      }
    }
  }, 60 * 1000)
}
