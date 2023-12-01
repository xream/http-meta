const net = require('net')

module.exports = { findAvailablePorts }

function findAvailablePorts(startPort, endPort, portCount) {
  return new Promise((resolve, reject) => {
    if (portCount <= 0 || startPort < endPort) {
      reject(new Error('Invalid arguments'))
      return
    }

    const availablePorts = []
    let currentPort = startPort

    function checkPortAvailability(port) {
      const server = net.createServer()
      return new Promise((resolve, reject) => {
        server.on('error', err => {
          if (err.code === 'EADDRINUSE') {
            resolve(false) // Port is in use
          } else {
            reject(err)
          }
        })

        server.on('listening', () => {
          server.close(() => {
            resolve(true) // Port is available
          })
        })

        server.listen(port)
      })
    }

    async function findPorts() {
      while (availablePorts.length < portCount && currentPort >= endPort) {
        const isAvailable = await checkPortAvailability(currentPort)
        if (isAvailable) {
          availablePorts.push(currentPort)
        }
        currentPort--
      }

      if (availablePorts.length === portCount) {
        resolve(availablePorts)
      } else {
        reject(new Error('Unable to find available ports'))
      }
    }

    findPorts()
  })
}
