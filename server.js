const Router = require('@koa/router')
const Koa = require('koa')
const bodyParser = require('koa-bodyparser')
const _ = require('lodash')

const udp = require('./utils/udp')

function createHttpMetaServer(options) {
  const env = options.env || process.env
  const meta = options.meta
  const app = new Koa()
  const router = new Router()
  const jsonLimit = env.BODY_JSON_LIMIT || '1mb'
  const authorization = env.AUTHORIZATION || ''
  let listener
  let closePromise
  let activeHandlers = 0
  let resolveHandlersDrained

  console.log(`\n[HTTP SERVER] body JSON limit: ${jsonLimit}`)
  app.use(bodyParser({ jsonLimit }))
  app.use(async (ctx, next) => {
    activeHandlers += 1
    try {
      return await next()
    } finally {
      activeHandlers -= 1
      if (activeHandlers === 0 && resolveHandlersDrained) {
        resolveHandlersDrained()
        resolveHandlersDrained = undefined
      }
    }
  })
  if (authorization) {
    console.log('Authorization Enabled')
    app.use(async (ctx, next) => {
      if (ctx.get('authorization') !== authorization) return ctx.throw(401)
      return next()
    })
  }

  router.post('/restart', handle(async ctx => meta.restart(ctx.request.body)))
  router.post('/start', handle(async ctx => meta.start(ctx.request.body)))
  router.post('/stop', handle(async ctx => meta.stop(ctx.request.body.pid)))
  router.get('/test', handle(async () => meta.test()))
  router.post(
    '/stats',
    handle(async ctx => {
      const pids = await meta.getPID(ctx.request.body.pid)
      return Object.fromEntries(
        await Promise.all(
          pids.map(async pid => {
            const { memoryBytes, cpuPercent, err, ports } = await meta.getStats(pid)
            return [
              pid,
              {
                pid,
                mem: `${_.round(Number.isFinite(memoryBytes) ? memoryBytes / 1024 / 1024 : 0, 2)}MB`,
                cpu: `${_.round(Number.isFinite(cpuPercent) ? cpuPercent : 0, 2)}%`,
                ports,
                err: err ? _.get(err, 'message') || String(err) : undefined,
              },
            ]
          })
        )
      )
    })
  )
  router.post(
    '/udp',
    handle(async ctx => ({ result: await udp(ctx.request.body) }))
  )

  app.use(router.routes()).use(router.allowedMethods())

  return {
    app,
    meta,
    listen(listenOptions = {}) {
      if (closePromise) throw new Error('HTTP server is closing')
      const port = listenOptions.port ?? env.PORT ?? 9876
      const host = listenOptions.host ?? env.HOST ?? '::'
      const current = app.listen(port, host, async () => {
        if (listener !== current) return
        const { address, port: listeningPort } = current.address()
        console.log(`[HTTP SERVER] listening on ${address}:${listeningPort}\n`)
        meta.startCheck()
      })
      listener = current
      return current
    },
    close(callback) {
      if (!closePromise) {
        const current = listener
        listener = undefined
        closePromise = !current
          ? Promise.resolve(meta.stopCheck())
          : new Promise((resolve, reject) => {
              current.close(error => {
                if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') return resolve()
                reject(error)
              })
            })
              .then(() => {
                if (activeHandlers === 0) return undefined
                return new Promise(resolve => {
                  resolveHandlersDrained = resolve
                })
              })
              .then(() => meta.stopCheck())
        const currentClose = closePromise
        const clearClosePromise = () => {
          if (closePromise === currentClose) closePromise = undefined
        }
        closePromise.then(clearClosePromise, clearClosePromise)
      }
      if (callback) closePromise.then(() => callback(), callback)
      return closePromise
    },
  }
}

function handle(action) {
  return async ctx => {
    try {
      ctx.body = await action(ctx)
    } catch (error) {
      ctx.throw(400, error)
    }
  }
}

module.exports = {
  createHttpMetaServer,
}
