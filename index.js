const meta = require('./meta')
const { createHttpMetaServer } = require('./server')

createHttpMetaServer({ meta }).listen()
