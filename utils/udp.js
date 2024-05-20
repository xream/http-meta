module.exports = ({ ntp = 'time.apple.com', port, timeout = 3 * 1000 } = {}) => {
  const p = new Promise((resolve, reject) => {
    const dgram = require('dgram')
    const SocksClient = require('socks').SocksClient
    // Create a local UDP socket for sending/receiving packets to/from the proxy.
    const udpSocket = dgram.createSocket('udp4')
    udpSocket.bind()

    // Listen for incoming UDP packets from the proxy server.
    udpSocket.on('message', (msg, rinfo) => {
      resolve('ok')
    })

    const options = {
      proxy: {
        host: '127.0.0.1',
        port,
        type: 5,
      },

      // This should be the ip and port of the expected client that will be sending UDP frames to the newly opened UDP port on the server.
      // Most SOCKS servers accept 0.0.0.0 as a wildcard address to accept UDP frames from any source.
      destination: {
        host: '0.0.0.0',
        port: 0,
      },

      command: 'associate',
    }

    const client = new SocksClient(options)

    // This event is fired when the SOCKS server has started listening on a new UDP port for UDP relaying.
    client.on('established', info => {
      // console.log(info);

      const packet = SocksClient.createUDPFrame({
        remoteHost: { host: ntp, port: 123 },
        data: Buffer.alloc(48, 0x23),
      })

      // Send packet.
      udpSocket.send(packet, info.remoteHost.port, info.remoteHost.host, e => {
        if (e) {
          console.error(e)
          udpSocket.close()
          reject(e)
        }
      })
    })

    // SOCKS proxy failed to bind.
    client.on('error', e => {
      console.error(e)
      reject(e)
    })

    client.connect()
  })
  return Promise.race([p, new Promise((_, reject) => setTimeout(() => reject('timeout'), timeout))])
}
