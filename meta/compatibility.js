function createCompatibilityApi(manager) {
  return {
    async start(input) {
      return toPID(await manager.start(input))
    },

    async stop(pid) {
      const result = await manager.stop(pid)
      return { pid: result.instanceIds }
    },

    async restart(input) {
      return toPID(await manager.restart(input))
    },

    getPID(pid) {
      return manager.list(pid)
    },

    getStats(pid) {
      return manager.stats(pid)
    },

    async test() {
      return toPID(await manager.test())
    },

    startCheck() {
      return manager.startCheck()
    },

    stopCheck() {
      return manager.stopCheck()
    },
  }
}

function toPID(value) {
  const { instanceId, ...result } = value
  return { ...result, pid: instanceId }
}

module.exports = {
  createCompatibilityApi,
}
