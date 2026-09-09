const childProcess = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setTimeout: delay } = require('node:timers/promises')

function resolveExecutablePath(options = {}) {
  const platform = options.platform || process.platform
  const fileSystem = options.fs || fs
  const pathApi = options.path || path
  const folder = options.folder
  const configuredPath = options.executablePath || process.env.META_BINARY_PATH
  if (configuredPath) return pathApi.resolve(configuredPath)

  const names = platform === 'win32' ? ['http-meta.exe', 'mihomo.exe'] : ['http-meta', 'mihomo']
  const candidates = names.map(name => pathApi.join(folder, name))
  return candidates.find(file => canAccess(fileSystem, file)) || candidates[0]
}

function createExecutableRuntime(options = {}) {
  const fileSystem = options.fs || fs
  const platform = options.platform || process.platform
  const spawnProcess = options.spawnProcess || childProcess.spawn
  const killProcess = options.killProcess || process.kill.bind(process)
  const executablePath = options.executablePath
  const tracked = new Set()
  const exited = new Set()

  if (!executablePath) throw new TypeError('Executable runtime requires executablePath')

  return {
    name: 'executable',
    executablePath,

    verify() {
      prepareExecutable(fileSystem, executablePath, platform)
    },

    async launch({ config, folder, log }) {
      prepareExecutable(fileSystem, executablePath, platform)

      const logFd = fileSystem.openSync(log, 'a')
      let child
      try {
        child = spawnProcess(executablePath, ['-d', folder, '-f', config], {
          cwd: folder,
          detached: true,
          stdio: ['ignore', logFd, logFd],
          windowsHide: true,
        })
        await new Promise((resolve, reject) => {
          child.once('error', reject)
          child.once('spawn', resolve)
        })
      } finally {
        fileSystem.closeSync(logFd)
      }

      tracked.add(child.pid)
      child.on('exit', () => {
        if (tracked.has(child.pid)) exited.add(child.pid)
      })
      child.unref()
      return { id: child.pid, pid: child.pid }
    },

    async terminate(id) {
      const pid = normalizePID(id)
      if (exited.has(pid)) return
      try {
        killProcess(pid, 'SIGKILL')
      } catch (error) {
        if (!isMissingProcess(error)) throw error
      }
    },

    async isActive(id) {
      const pid = normalizePID(id)
      if (exited.delete(pid)) {
        tracked.delete(pid)
        return false
      }
      try {
        killProcess(pid, 0)
        return true
      } catch (error) {
        if (isMissingProcess(error)) {
          tracked.delete(pid)
          exited.delete(pid)
          return false
        }
        if (error && error.code === 'EPERM') return true
        throw error
      }
    },

    async readStats(id) {
      const pid = normalizePID(id)
      if (platform === 'linux') return getLinuxStats(fileSystem, pid)
      if (platform === 'darwin') return getDarwinStats(options.execFile || childProcess.execFile, pid)
      return {}
    },

    async discover() {
      if (platform === 'linux') return discoverLinuxProcesses(fileSystem)
      if (platform === 'darwin') return discoverDarwinProcesses(options.execFile || childProcess.execFile)
      return []
    },
  }
}

function prepareExecutable(fileSystem, executablePath, platform) {
  fileSystem.accessSync(executablePath)
  if (platform === 'win32') return

  const mode = fileSystem.statSync(executablePath).mode
  if ((mode & 0o111) !== 0o111) fileSystem.chmodSync(executablePath, mode | 0o111)
}

function normalizePID(id) {
  const pid = Number(id)
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError(`Invalid process id: ${id}`)
  return pid
}

function isMissingProcess(error) {
  return error && (error.code === 'ESRCH' || error.code === 'ENOENT')
}

function canAccess(fileSystem, file) {
  try {
    fileSystem.accessSync(file)
    return true
  } catch (error) {
    return false
  }
}

async function getLinuxStats(fileSystem, pid) {
  try {
    const first = readLinuxCPU(fileSystem, pid)
    await delay(50)
    const second = readLinuxCPU(fileSystem, pid)
    const totalDelta = second.total - first.total
    const processDelta = second.process - first.process
    const cpuPercent = totalDelta > 0 ? (processDelta / totalDelta) * os.cpus().length * 100 : 0
    const status = fileSystem.readFileSync(`/proc/${pid}/status`, 'utf8')
    const rss = status.match(/^VmRSS:\s+(\d+)\s+kB$/m)
    return {
      memoryBytes: rss ? Number(rss[1]) * 1024 : undefined,
      cpuPercent,
    }
  } catch (error) {
    return {}
  }
}

function readLinuxCPU(fileSystem, pid) {
  const stat = fileSystem.readFileSync(`/proc/${pid}/stat`, 'utf8')
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/)
  const processTicks = Number(fields[11]) + Number(fields[12])
  const cpuLine = fileSystem.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1)
  return {
    process: processTicks,
    total: cpuLine.reduce((sum, value) => sum + Number(value), 0),
  }
}

function getDarwinStats(execFile, pid) {
  return new Promise(resolve => {
    execFile('ps', ['-p', String(pid), '-o', 'rss=,pcpu='], (error, stdout) => {
      if (error) return resolve({})
      const [rss, cpu] = String(stdout).trim().split(/\s+/).map(Number)
      resolve({
        memoryBytes: Number.isFinite(rss) ? rss * 1024 : undefined,
        cpuPercent: Number.isFinite(cpu) ? cpu : undefined,
      })
    })
  })
}

function discoverLinuxProcesses(fileSystem) {
  try {
    return fileSystem
      .readdirSync('/proc', { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
      .flatMap(entry => {
        try {
          const name = fileSystem.readFileSync(`/proc/${entry.name}/comm`, 'utf8').trim()
          if (name !== 'http-meta') return []
          const status = fileSystem.readFileSync(`/proc/${entry.name}/status`, 'utf8')
          const state = status.match(/^State:\s+(\S)/m)
          return !state || state[1] !== 'Z' ? [Number(entry.name)] : []
        } catch (error) {
          return []
        }
      })
  } catch (error) {
    return []
  }
}

function discoverDarwinProcesses(execFile) {
  return new Promise(resolve => {
    execFile('pgrep', ['http-meta'], (error, stdout) => {
      if (error) return resolve([])
      const pids = String(stdout)
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
        .filter(Number.isSafeInteger)
      resolve(pids)
    })
  })
}

module.exports = {
  createExecutableRuntime,
  resolveExecutablePath,
}
