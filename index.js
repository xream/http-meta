const PORT = process.env.PORT || 9876
const HOST = process.env.HOST || '::'
const AUTHORIZATION = process.env.AUTHORIZATION || ''

const _ = require('lodash')
const Koa = require('koa')
const bodyParser = require('koa-bodyparser')
const Router = require('@koa/router')
const meta = require('./meta')
const udp = require('./utils/udp')

const app = new Koa()
const router = new Router()

const jsonLimit = process.env.BODY_JSON_LIMIT || '1mb'

console.log(`\n[HTTP SERVER] body JSON limit: ${jsonLimit}`)

app.use(bodyParser({ jsonLimit }))
if (AUTHORIZATION) {
  console.log(`Authorization Enabled`)
  app.use(async (ctx, next) => {
    if (ctx.get('authorization') !== AUTHORIZATION) return ctx.throw(401)
    return next()
  })
}

router.post('/restart', async (ctx, next) => {
  try {
    ctx.body = await meta.restart(ctx.request.body)
  } catch (e) {
    ctx.throw(400, e)
  }
})

router.post('/start', async (ctx, next) => {
  try {
    ctx.body = await meta.start(ctx.request.body)
  } catch (e) {
    ctx.throw(400, e)
  }
})

router.post('/stop', async (ctx, next) => {
  try {
    ctx.body = await meta.stop(ctx.request.body.pid)
  } catch (e) {
    ctx.throw(400, e)
  }
})
router.get('/test', async (ctx, next) => {
  try {
    ctx.body = await meta.test()
  } catch (e) {
    ctx.throw(400, e)
  }
})
router.post('/stats', async (ctx, next) => {
  try {
    const pid = await meta.getPID(ctx.request.body.pid)
    const stats = {}
    _.map(pid, i => {
      const { mem, cpu, err, ports } = meta.getStats(pid)
      stats[i] = {
        pid: i,
        mem: `${(_.round(mem / 1024), 2)}MB`,
        cpu: `${_.round(cpu, 2)}%`,
        ports,
        err: err ? _.get(err, 'message') || String(err) : undefined,
      }
    })
    ctx.body = stats
  } catch (e) {
    ctx.throw(400, e)
  }
})
router.post('/udp', async (ctx, next) => {
  try {
    ctx.body = {
      result: await udp(ctx.request.body),
    }
  } catch (e) {
    ctx.throw(400, e)
  }
})

app.use(router.routes()).use(router.allowedMethods())

const listener = app.listen(PORT, HOST, async ctx => {
  const { address, port } = listener.address()
  console.log(`[HTTP SERVER] listening on ${address}:${port}\n`)
  await meta.startCheck()
})
