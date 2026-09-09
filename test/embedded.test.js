const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createHttpMetaServer } = require('../server')

test('embedded entry loads without child_process', t => {
  const originalLoad = Module._load
  t.after(() => {
    Module._load = originalLoad
  })
  Module._load = function (request, parent, isMain) {
    if (request === 'child_process') throw new Error('child_process is unavailable')
    return originalLoad.call(this, request, parent, isMain)
  }

  const embedded = require('../embedded')
  assert.equal(typeof embedded.createEmbeddedHttpMeta, 'function')
  assert.equal(typeof embedded.createHostRuntime, 'function')
})

test('host runtime delegates lifecycle to the application bridge', async () => {
  const calls = []
  const { createHostRuntime } = require('../embedded')
  const runtime = createHostRuntime({
    async startMihomo(configText, context) {
      calls.push(['start', configText, context.config])
      return 'native-1'
    },
    async stopMihomo(id) {
      calls.push(['stop', id])
    },
    async isMihomoActive(id) {
      calls.push(['active', id])
      return true
    },
  })

  assert.deepEqual(await runtime.launch({ config: '/tmp/config.yaml', configText: 'proxies: []', log: 'log' }), {
    id: 'native-1',
  })
  await runtime.terminate('native-1')
  assert.equal(await runtime.isActive('native-1'), true)
  assert.deepEqual(calls, [
    ['start', 'proxies: []', '/tmp/config.yaml'],
    ['stop', 'native-1'],
    ['active', 'native-1'],
  ])
})

test('embedded server preserves the numeric pid HTTP contract', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'http-meta-embedded-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  fs.writeFileSync(path.join(folder, 'tpl.yaml'), 'bind-address: 127.0.0.1\n')

  let active = true
  const { createEmbeddedHttpMeta } = require('../embedded')
  const service = createEmbeddedHttpMeta({
    bridge: {
      async startMihomo() {
        return 'native-1'
      },
      async stopMihomo() {
        active = false
      },
      async isMihomoActive() {
        return active
      },
    },
    createPID: () => 1001,
    findPorts: async () => [12000],
    folder,
    tempFolder: folder,
  })
  const listener = service.listen({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => listener.once('listening', resolve))
  t.after(() => service.close())

  const address = listener.address()
  const startResponse = await fetch(`http://127.0.0.1:${address.port}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proxies: [{ name: 'proxy' }] }),
  })
  assert.equal(startResponse.status, 200)
  const startBody = await startResponse.json()
  assert.deepEqual(startBody.ports, [12000])
  assert.equal(startBody.pid, 1001)
  assert.equal(typeof startBody.config, 'string')
  assert.equal(typeof startBody.log, 'string')

  const statsResponse = await fetch(`http://127.0.0.1:${address.port}/stats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid: 1001 }),
  })
  assert.equal(statsResponse.status, 200)
  assert.deepEqual(await statsResponse.json(), {
    1001: { pid: 1001, mem: '0MB', cpu: '0%', ports: [12000] },
  })

  const stopResponse = await fetch(`http://127.0.0.1:${address.port}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid: 1001 }),
  })
  assert.equal(stopResponse.status, 200)
  assert.deepEqual(await stopResponse.json(), { pid: [] })
})

test('server close resolves only after the timeout checker has stopped', async () => {
  let finishStop
  const meta = {
    getPID: async () => [],
    getStats: async () => ({}),
    restart: async () => ({}),
    start: async () => ({}),
    startCheck() {},
    stop: async () => ({}),
    stopCheck: () => new Promise(resolve => {
      finishStop = resolve
    }),
    test: async () => ({}),
  }
  const service = createHttpMetaServer({ env: {}, meta })
  let closed = false
  const closing = service.close().then(() => {
    closed = true
  })

  await Promise.resolve()
  assert.equal(closed, false)
  finishStop()
  await closing
  assert.equal(closed, true)
})

test('server close waits for in-flight HTTP handlers before stopping checks', async t => {
  let releaseStart
  let startEntered
  let stopChecks = 0
  const meta = {
    getPID: async () => [],
    getStats: async () => ({}),
    restart: async () => ({}),
    start: async () => {
      startEntered()
      await new Promise(resolve => {
        releaseStart = resolve
      })
      return {}
    },
    startCheck() {},
    stop: async () => ({}),
    stopCheck() {
      stopChecks += 1
    },
    test: async () => ({}),
  }
  const service = createHttpMetaServer({ env: {}, meta })
  const listener = service.listen({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => listener.once('listening', resolve))
  t.after(() => service.close())

  const request = fetch(`http://127.0.0.1:${listener.address().port}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  await new Promise(resolve => {
    startEntered = resolve
  })

  const closing = service.close()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopChecks, 0)

  releaseStart()
  await request
  await closing
  assert.equal(stopChecks, 1)
})

test('an immediate close prevents a pending listener from starting the timeout checker', async () => {
  let finishStop
  let starts = 0
  const meta = {
    getPID: async () => [],
    getStats: async () => ({}),
    restart: async () => ({}),
    start: async () => ({}),
    startCheck() {
      starts += 1
    },
    stop: async () => ({}),
    stopCheck: () => new Promise(resolve => {
      finishStop = resolve
    }),
    test: async () => ({}),
  }
  const service = createHttpMetaServer({ env: {}, meta })
  let closeListener
  let startListener
  service.app.listen = (port, host, callback) => {
    startListener = callback
    return {
      address() {
        return { address: host, port }
      },
      close(callback) {
        closeListener = callback
      },
    }
  }
  service.listen({ host: '127.0.0.1', port: 0 })
  const closing = service.close()

  startListener()
  closeListener()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(starts, 0)
  finishStop()
  await closing
})
