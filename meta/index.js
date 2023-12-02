const shell = require('shelljs')
const YAML = require('yamljs')
const fs = require('fs')
const path = require('path')
const _ = require('lodash')
const { findAvailablePorts } = require('../utils/port')

const processes = {}

const folder = __dirname
const bin = path.join(__dirname, 'http-meta')
const tpl = path.join(__dirname, 'tpl.yaml')
const config = path.join(__dirname, 'config.yaml')
const log = path.join(__dirname, 'http-meta.log')

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
  shell.exec(`rm -f ${config}`)
  shell.exec(`mv ${log} ${log}.old > /dev/null 2>&1`)

  const info = await genConfig(input)

  shell.exec(`chmod a+x ${bin}`)

  let pid = shell.exec(`${bin} -d ${folder} -f ${config} > ${log} 2>&1 &\necho $!`, { silent: true }).stdout.trim()
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
      shell.exec(`kill -9 ${i}`, { silent: true })
      const stdout = shell
        .exec(`ps -p ${i}`, { silent: true })
        .stdout.trim()
        .split(/[\r\n]+/)
        .map(i => i.trim())
        .filter(i => i.length)

      if (_.chain(stdout).get(1).startsWith(`${i}`).value()) {
        pid.push(i)
      }
    })
  } else {
    shell.exec(`pkill http-meta`)
    pid = await getPID()
    if (pid) {
      shell.exec(`kill -9 ${pid}`)
    }
    pid = await getPID()
  }
  if (!_.isEmpty(pid)) {
    throw new Error(`Cannot stop PID: ${pid}`)
  }
  return { pid }
}
async function getPID(_pid) {
  let pid = shell.exec(`pgrep http-meta`, { silent: true }).stdout.trim()

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
  const proxies = _.get(input, 'proxies') || input
  // const [port, ...ports] = await findAvailablePorts(65535, 1, proxies.length + 1)
  const ports = await findAvailablePorts(65535, 1, proxies.length)

  const yaml = YAML.parse(fs.readFileSync(tpl, 'utf8'))

  yaml['bind-address'] = `0.0.0.0`
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

  const output = shell.exec(command, { silent: true }).stdout

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
