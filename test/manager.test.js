const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createManager } = require('../meta/manager')

function fixture(t) {
  const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'http-meta-test-'))
  t.after(() => fs.rmSync(tempFolder, { recursive: true, force: true }))

  const tpl = path.join(tempFolder, 'tpl.yaml')
  fs.writeFileSync(tpl, 'bind-address: 127.0.0.1\n')

  let stored = { processes: {} }
  const dataFile = {
    read() {
      return JSON.parse(JSON.stringify(stored))
    },
    write(value) {
      stored = JSON.parse(JSON.stringify(value))
    },
    get value() {
      return stored
    },
  }

  return { dataFile, tempFolder, tpl }
}

function captureInterval(t) {
  const originalSetInterval = global.setInterval
  const originalClearInterval = global.clearInterval
  let runTick
  global.setInterval = callback => {
    runTick = callback
    return { unref() {} }
  }
  global.clearInterval = () => {}
  t.after(() => {
    global.setInterval = originalSetInterval
    global.clearInterval = originalClearInterval
  })
  return () => runTick()
}

test('manager maps an opaque runtime id to a numeric pid compatibility field', async t => {
  const files = fixture(t)
  const stopped = []
  let running = true
  const runtime = {
    name: 'libmihomo',
    async launch({ configText }) {
      assert.match(configText, /listeners:/)
      return { id: 'instance-a' }
    },
    async terminate(id) {
      stopped.push(id)
      running = false
    },
    async isActive() {
      return running
    },
  }
  const manager = createManager({
    ...files,
    activeRuntime: 'libmihomo',
    createPID: () => 1001,
    disableAutoClean: true,
    findPorts: async () => [12000],
    folder: files.tempFolder,
    runtimes: [runtime],
  })

  const info = await manager.start({ proxies: [{ name: 'a' }] })
  assert.equal(info.instanceId, 1001)
  assert.equal(info.pid, undefined)
  assert.deepEqual(await manager.list(), [1001])

  assert.deepEqual(await manager.stop(1001), { instanceIds: [] })
  assert.deepEqual(stopped, ['instance-a'])
})

test('stop all only targets registered instances and cleans generated files with fs APIs', async t => {
  const files = fixture(t)
  const stopped = []
  const runtime = {
    name: 'executable',
    async launch() {
      throw new Error('not used')
    },
    async terminate(id) {
      stopped.push(id)
    },
    async isActive() {
      return false
    },
    async discover() {
      return [10, 20, 30]
    },
  }
  files.dataFile.write({
    processes: {
      10: { id: 10, runtime: 'executable', ports: [] },
      20: { id: 20, runtime: 'executable', ports: [] },
    },
  })
  fs.writeFileSync(path.join(files.tempFolder, 'http-meta.old.log'), 'log')
  fs.writeFileSync(path.join(files.tempFolder, 'http-meta.old.yaml'), 'config')
  fs.writeFileSync(path.join(files.tempFolder, 'keep.log'), 'keep')

  const manager = createManager({
    ...files,
    activeRuntime: 'executable',
    disableAutoClean: false,
    findPorts: async () => [],
    folder: files.tempFolder,
    runtimes: [runtime],
  })

  assert.deepEqual(await manager.stop(), { instanceIds: [] })
  assert.deepEqual(stopped, [10, 20, 30])
  assert.equal(files.dataFile.value.processes, undefined)
  assert.deepEqual(files.dataFile.value.instances, {})
  assert.equal(fs.existsSync(path.join(files.tempFolder, 'http-meta.old.log')), false)
  assert.equal(fs.existsSync(path.join(files.tempFolder, 'http-meta.old.yaml')), false)
  assert.equal(fs.existsSync(path.join(files.tempFolder, 'keep.log')), true)
})

test('manager delegates stats to the runtime without requiring the process model', async t => {
  const files = fixture(t)
  const runtime = {
    name: 'libmihomo',
    async launch() {
      throw new Error('not used')
    },
    async terminate() {},
    async isActive() {
      return true
    },
    async readStats(id) {
      assert.equal(id, 'instance-a')
      return { memoryBytes: 2048, cpuPercent: 1.5 }
    },
  }
  files.dataFile.write({
    processes: {
      1001: { id: 'instance-a', pid: 1001, runtime: 'libmihomo', ports: [12000] },
    },
  })
  const manager = createManager({
    ...files,
    activeRuntime: 'libmihomo',
    disableAutoClean: true,
    findPorts: async () => [],
    folder: files.tempFolder,
    runtimes: [runtime],
  })

  assert.deepEqual(await manager.stats(1001), {
    ports: [12000],
    memoryBytes: 2048,
    cpuPercent: 1.5,
    err: undefined,
  })
})

test('stopCheck waits for an in-flight tick and prevents later runtime calls', async t => {
  const files = fixture(t)
  const runTick = captureInterval(t)

  let releaseFirstCheck
  let firstCheckStarted
  const firstCheck = new Promise(resolve => {
    firstCheckStarted = resolve
  })
  const activeCalls = []
  const runtime = {
    name: 'host',
    async launch() {
      throw new Error('not used')
    },
    async terminate() {
      throw new Error('timeout stop must not run after stopCheck')
    },
    async isActive(id) {
      activeCalls.push(id)
      if (id === 'native-1') {
        firstCheckStarted()
        return new Promise(resolve => {
          releaseFirstCheck = resolve
        })
      }
      return true
    },
  }
  files.dataFile.write({
    instances: {
      1001: { runtimeId: 'native-1', runtime: 'host', startTime: Date.now(), timeout: 60000 },
      1002: { runtimeId: 'native-2', runtime: 'host', startTime: Date.now(), timeout: 60000 },
    },
  })
  const manager = createManager({
    ...files,
    activeRuntime: 'host',
    disableAutoClean: true,
    findPorts: async () => [],
    folder: files.tempFolder,
    runtimes: [runtime],
  })

  manager.startCheck()
  const tick = runTick()
  await firstCheck
  const stopping = manager.stopCheck()
  assert.equal(typeof stopping.then, 'function')
  releaseFirstCheck(true)
  await Promise.all([tick, stopping])
  assert.deepEqual(activeCalls, ['native-1'])
})

test('automatic timeout does not terminate an instance whose identity is unverified', async t => {
  const files = fixture(t)
  const runTick = captureInterval(t)
  const terminated = []
  const runtime = {
    name: 'executable',
    async launch() {
      throw new Error('not used')
    },
    async terminate(id) {
      terminated.push(id)
    },
    async isActive() {
      return true
    },
    async canAutoTerminate() {
      return false
    },
  }
  files.dataFile.write({
    instances: {
      1001: { runtimeId: 1001, runtime: 'executable', startTime: 0, timeout: 1 },
    },
  })
  const manager = createManager({
    ...files,
    activeRuntime: 'executable',
    disableAutoClean: true,
    findPorts: async () => [],
    folder: files.tempFolder,
    runtimes: [runtime],
  })

  manager.startCheck()
  await runTick()
  await manager.stopCheck()
  assert.deepEqual(terminated, [])
  assert.match(files.dataFile.value.instances['1001'].err.message, /identity could not be verified/)
})
