const fs = require('fs')
const os = require('os')
const path = require('path')

const folder = path.resolve(process.env.META_TEMP_FOLDER || os.tmpdir())
const dataFile = path.join(folder, 'http-meta.json')

console.log(`[DATA FILE] "${dataFile}"`)

module.exports = {
  read,
  write,
}
function read() {
  try {
    fs.accessSync(dataFile)
  } catch (e) {
    write({ processes: {} })
  }
  const jsonData = fs.readFileSync(dataFile, 'utf8')
  return JSON.parse(jsonData)
}

function write(data) {
  const jsonData = JSON.stringify(data)
  fs.writeFileSync(dataFile, jsonData, 'utf8')
}
