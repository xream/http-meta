const assert = require('node:assert/strict')
const test = require('node:test')

const { createCompatibilityApi } = require('../meta/compatibility')

test('HTTP compatibility API keeps pid fields outside the core manager', async () => {
  const manager = {
    async start() {
      return { instanceId: 1001, ports: [12000], config: 'config', log: 'log' }
    },
    async stop() {
      return { instanceIds: [] }
    },
    async list() {
      return [1001]
    },
    async stats() {
      return { memoryBytes: 1024 }
    },
    async restart() {
      return { instanceId: 1002, ports: [12001] }
    },
    async test() {
      return { instanceId: 1003, log: 'ok' }
    },
    startCheck() {},
  }
  const api = createCompatibilityApi(manager)

  assert.deepEqual(await api.start({}), {
    pid: 1001,
    ports: [12000],
    config: 'config',
    log: 'log',
  })
  assert.deepEqual(await api.stop(1001), { pid: [] })
  assert.deepEqual(await api.getPID(), [1001])
  assert.deepEqual(await api.restart({}), { pid: 1002, ports: [12001] })
  assert.deepEqual(await api.test(), { pid: 1003, log: 'ok' })
})
