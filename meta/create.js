const fs = require('fs')
const os = require('os')
const path = require('path')

const { findAvailablePorts } = require('../utils/port')
const { createDataFile } = require('../utils/data')
const { createCompatibilityApi } = require('./compatibility')
const { createManager } = require('./manager')
const { validateRuntime } = require('./runtime')

function createMeta(options = {}) {
  const env = options.env || process.env
  const fileSystem = options.fs || fs
  const runtime = validateRuntime(options.runtime)
  const tempFolder = path.resolve(options.tempFolder || env.META_TEMP_FOLDER || os.tmpdir())
  const folder = path.resolve(options.folder || env.META_FOLDER || __dirname)
  const tpl = path.resolve(options.tpl || path.join(folder, 'tpl.yaml'))
  const maxAvailablePort = parsePort(options.maxAvailablePort || env.META_MAX_AVAILABLE_PORT, 65534)
  const minAvailablePort = parsePort(options.minAvailablePort || env.META_MIN_AVAILABLE_PORT, 1)
  const disableAutoClean =
    options.disableAutoClean === undefined ? parseBoolean(env.META_DISABLE_AUTO_CLEAN) : options.disableAutoClean

  if (minAvailablePort > maxAvailablePort) throw new Error('minAvailablePort > maxAvailablePort')
  assertDirectory(fileSystem, folder, 'Meta folder', 'META_FOLDER')
  assertDirectory(fileSystem, tempFolder, 'Meta temp folder', 'META_TEMP_FOLDER')
  assertFile(fileSystem, tpl, 'Meta Config Template')

  console.log(`[META AVAILABLE PORT] ${minAvailablePort}-${maxAvailablePort}`)
  console.log(`[DISABLE AUTO CLEAN] ${disableAutoClean ? 'true' : 'false'}`)
  console.log(`[META FOLDER] ${folder}`)
  console.log(`[META TEMP FOLDER] ${tempFolder}`)
  console.log(`[META CONFIG TEMPLATE] ${tpl}`)
  console.log(`[META RUNTIME] ${runtime.name}`)

  const manager = createManager({
    activeRuntime: runtime.name,
    createPID: options.createPID,
    dataFile: options.dataFile || createDataFile(tempFolder, fileSystem),
    disableAutoClean,
    findPorts: options.findPorts || findAvailablePorts,
    folder,
    fs: fileSystem,
    maxAvailablePort,
    minAvailablePort,
    runtimes: [runtime, ...(options.additionalRuntimes || [])],
    tempFolder,
    tpl,
  })
  return createCompatibilityApi(manager)
}

function parsePort(value, fallback) {
  const port = Number.parseInt(value, 10)
  return Number.isInteger(port) && port >= 1 && port <= 65534 ? port : fallback
}

function parseBoolean(value) {
  try {
    return Boolean(JSON.parse(value))
  } catch (error) {
    return Boolean(value)
  }
}

function assertDirectory(fileSystem, directory, label, variable) {
  try {
    if (!fileSystem.statSync(directory).isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new Error(`${label} "${directory}" does not exist. This can be customized using "${variable}"`)
  }
}

function assertFile(fileSystem, file, label) {
  try {
    fileSystem.accessSync(file)
  } catch (error) {
    throw new Error(`${label} "${file}" does not exist`)
  }
}

module.exports = {
  createMeta,
}
