const fs = require('fs')
const path = require('path')

function createDataFile(folder, fileSystem = fs) {
  const file = path.join(folder, 'http-meta.json')
  console.log(`[DATA FILE] "${file}"`)

  return {
    read() {
      try {
        return JSON.parse(fileSystem.readFileSync(file, 'utf8'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        const data = { instances: {} }
        this.write(data)
        return data
      }
    },

    write(data) {
      fileSystem.writeFileSync(file, JSON.stringify(data), 'utf8')
    },
  }
}

module.exports = {
  createDataFile,
}
