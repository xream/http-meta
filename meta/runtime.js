const requiredMethods = ['launch', 'terminate', 'isActive']

function validateRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') {
    throw new TypeError('Mihomo runtime must be an object')
  }
  if (typeof runtime.name !== 'string' || !runtime.name.trim()) {
    throw new TypeError('Mihomo runtime must have a non-empty name')
  }
  for (const method of requiredMethods) {
    if (typeof runtime[method] !== 'function') {
      throw new TypeError(`Mihomo runtime "${runtime.name}" must implement ${method}()`)
    }
  }
  if (runtime.readStats !== undefined && typeof runtime.readStats !== 'function') {
    throw new TypeError(`Mihomo runtime "${runtime.name}" readStats must be a function`)
  }
  if (runtime.discover !== undefined && typeof runtime.discover !== 'function') {
    throw new TypeError(`Mihomo runtime "${runtime.name}" discover must be a function`)
  }
  if (runtime.canAutoTerminate !== undefined && typeof runtime.canAutoTerminate !== 'function') {
    throw new TypeError(`Mihomo runtime "${runtime.name}" canAutoTerminate must be a function`)
  }
  return runtime
}

module.exports = {
  validateRuntime,
}
