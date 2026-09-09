const { validateRuntime } = require('./runtime')

function createHostRuntime(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new TypeError('Host runtime requires a bridge object')
  for (const method of ['startMihomo', 'stopMihomo', 'isMihomoActive']) {
    if (typeof bridge[method] !== 'function') throw new TypeError(`Host bridge must implement ${method}()`)
  }

  return validateRuntime({
    name: bridge.name || 'host',

    async launch(context) {
      const result = await bridge.startMihomo(context.configText, {
        config: context.config,
        input: context.input,
        log: context.log,
      })
      if (result && typeof result === 'object' && result.id !== undefined) return result
      return { id: result }
    },

    terminate(id) {
      return bridge.stopMihomo(id)
    },

    isActive(id) {
      return bridge.isMihomoActive(id)
    },

    readStats:
      typeof bridge.getMihomoStats === 'function' ? id => bridge.getMihomoStats(id) : undefined,
  })
}

module.exports = {
  createHostRuntime,
}
