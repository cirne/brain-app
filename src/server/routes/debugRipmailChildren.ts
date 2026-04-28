import { Hono } from 'hono'
import { getRipmailChildDebugSnapshot } from '@server/lib/ripmail/ripmailRun.js'

const r = new Hono()

r.get('/children', (c) => {
  return c.json(getRipmailChildDebugSnapshot())
})

export default r
