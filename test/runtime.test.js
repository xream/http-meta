const assert = require('node:assert/strict')
const test = require('node:test')

const { createExecutableRuntime, resolveExecutablePath } = require('../meta/executable-runtime')
const { validateRuntime } = require('../meta/runtime')

test('Windows resolves a packaged mihomo.exe without chmod', async () => {
  const calls = []
  const fakeFs = {
    accessSync(file) {
      calls.push(['access', file])
      if (!file.endsWith('mihomo.exe')) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    chmodSync(file, mode) {
      calls.push(['chmod', file, mode])
    },
    closeSync() {},
    openSync() {
      return 1
    },
  }

  const executablePath = resolveExecutablePath({
    folder: 'C:\\http-meta\\meta',
    fs: fakeFs,
    path: require('node:path').win32,
    platform: 'win32',
  })
  const runtime = createExecutableRuntime({
    executablePath,
    fs: fakeFs,
    platform: 'win32',
    spawnProcess() {
      const listeners = new Map()
      queueMicrotask(() => listeners.get('spawn')?.())
      return {
        pid: 42,
        once(event, listener) {
          listeners.set(event, listener)
        },
        on() {},
        unref() {},
      }
    },
  })

  const handle = await runtime.launch({ config: 'config.yaml', log: 'mihomo.log' })

  assert.deepEqual(handle, { id: 42, pid: 42 })
  assert.equal(executablePath, 'C:\\http-meta\\meta\\mihomo.exe')
  assert.equal(calls.some(([name]) => name === 'chmod'), false)
})

test('executable runtime uses process.kill-compatible hooks for liveness and stop', async () => {
  const signals = []
  const runtime = createExecutableRuntime({
    executablePath: '/opt/http-meta',
    fs: {
      accessSync() {},
      chmodSync() {},
      readlinkSync() {
        return '/opt/http-meta'
      },
      realpathSync(file) {
        return file
      },
      statSync() {
        return { mode: 0o100644 }
      },
    },
    killProcess(pid, signal) {
      signals.push([pid, signal])
    },
    platform: 'linux',
  })

  assert.equal(await runtime.isActive(123), true)
  await runtime.terminate(123)

  assert.deepEqual(signals, [
    [123, 0],
    [123, 'SIGKILL'],
  ])
})

test('executable runtime refuses to terminate an unowned PID', async () => {
  const signals = []
  const runtime = createExecutableRuntime({
    executablePath: '/opt/mihomo',
    fs: {
      readlinkSync() {
        return '/usr/bin/unrelated'
      },
      realpathSync(file) {
        return file
      },
    },
    killProcess(pid, signal) {
      signals.push([pid, signal])
    },
    platform: 'linux',
  })

  await assert.rejects(runtime.terminate(123), /Cannot automatically terminate PID: 123/)
  assert.deepEqual(signals, [])
})

test('Windows stats do not invoke a system command', async () => {
  let invoked = false
  const runtime = createExecutableRuntime({
    executablePath: 'C:\\http-meta\\mihomo.exe',
    execFile() {
      invoked = true
    },
    platform: 'win32',
  })

  assert.deepEqual(await runtime.readStats(42), {})
  assert.equal(invoked, false)
})

test('missing macOS compatibility commands degrade without failing lifecycle support', async () => {
  const runtime = createExecutableRuntime({
    executablePath: '/Applications/http-meta',
    execFile(command, args, callback) {
      callback(Object.assign(new Error(`${command} missing`), { code: 'ENOENT' }))
    },
    platform: 'darwin',
  })

  assert.deepEqual(await runtime.discover(), [])
  assert.deepEqual(await runtime.readStats(42), {})
})

test('automatic termination verifies an untracked Linux process by executable path', async () => {
  let runningExecutable = '/opt/mihomo'
  const runtime = createExecutableRuntime({
    executablePath: '/opt/mihomo',
    fs: {
      readlinkSync() {
        return runningExecutable
      },
      realpathSync(file) {
        return file
      },
    },
    killProcess() {},
    platform: 'linux',
  })

  assert.equal(await runtime.canAutoTerminate(123), true)
  runningExecutable = '/usr/bin/unrelated'
  assert.equal(await runtime.canAutoTerminate(123), false)
})

test('Android uses Linux /proc helpers for ownership, stats, and discovery', async () => {
  const runtime = createExecutableRuntime({
    executablePath: '/opt/mihomo',
    fs: {
      readlinkSync() {
        return '/opt/mihomo'
      },
      realpathSync(file) {
        return file
      },
      readdirSync() {
        return [{ name: '123', isDirectory: () => true }]
      },
      readFileSync(file) {
        if (file === '/proc/123/comm') return 'mihomo\n'
        if (file === '/proc/123/status') return 'State:\tS (sleeping)\nVmRSS:\t2 kB\n'
        if (file === '/proc/123/stat') return '123 (mihomo) S 0 0 0 0 0 0 0 0 0 0 0 0 0\n'
        if (file === '/proc/stat') return 'cpu 100 0 0 0\n'
        throw new Error(`Unexpected file: ${file}`)
      },
    },
    platform: 'android',
  })

  assert.equal(await runtime.canAutoTerminate(123), true)
  assert.deepEqual(await runtime.discover(), [123])
  assert.deepEqual(await runtime.readStats(123), { memoryBytes: 2048, cpuPercent: 0 })
})

test('automatic termination stays disabled when process identity cannot be verified', async () => {
  const runtime = createExecutableRuntime({
    executablePath: 'C:\\http-meta\\mihomo.exe',
    fs: {},
    killProcess() {},
    platform: 'win32',
  })

  assert.equal(await runtime.canAutoTerminate(123), false)
})

test('an already executable file does not require chmod permission', () => {
  const calls = []
  const runtime = createExecutableRuntime({
    executablePath: '/opt/mihomo',
    fs: {
      accessSync(file, mode) {
        calls.push(['access', file, mode])
      },
      chmodSync() {
        throw Object.assign(new Error('read-only filesystem'), { code: 'EROFS' })
      },
      statSync() {
        return { mode: 0o100700 }
      },
    },
    platform: 'linux',
  })

  assert.doesNotThrow(() => runtime.verify())
  assert.equal(calls.some(([name]) => name === 'chmod'), false)
})

test('runtime adapters use opaque instance ids and may omit stats', () => {
  const adapter = validateRuntime({
    name: 'libmihomo',
    async launch() {
      return { id: 'session-a' }
    },
    async terminate() {},
    async isActive() {
      return true
    },
  })

  assert.equal(adapter.name, 'libmihomo')
  assert.equal(adapter.readStats, undefined)
})
