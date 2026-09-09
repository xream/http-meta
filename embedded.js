const { createMeta } = require('./meta/create')
const { createHostRuntime } = require('./meta/host-runtime')
const { createHttpMetaServer } = require('./server')

function createEmbeddedHttpMeta(options = {}) {
  const { bridge, runtime: providedRuntime, ...metaOptions } = options
  const runtime = providedRuntime || createHostRuntime(bridge)
  const meta = createMeta({ ...metaOptions, runtime })
  return createHttpMetaServer({ env: metaOptions.env, meta })
}

module.exports = {
  createEmbeddedHttpMeta,
  createHostRuntime,
}
