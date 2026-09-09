const path = require('path')

const { createMeta } = require('./create')
const { createExecutableRuntime, resolveExecutablePath } = require('./executable-runtime')

const folder = path.resolve(process.env.META_FOLDER || __dirname)
const executablePath = resolveExecutablePath({ folder })
const runtime = createExecutableRuntime({ executablePath })

try {
  runtime.verify()
  console.log(`[META CORE] ${executablePath}`)
} catch (error) {
  console.log(`Meta Core "${executablePath}" does not exist`)
  process.exit(1)
}

module.exports = createMeta({ folder, runtime })
