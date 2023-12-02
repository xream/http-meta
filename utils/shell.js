const { execSync } = require('child_process')

module.exports = {
  safeExecSync(...args) {
    try {
      return execSync(...args).toString('utf-8')
    } catch (e) {
      // console.error(e)
      return ''
    }
  },
}
