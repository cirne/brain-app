import { Hono } from 'hono'
import { getRipmailChildDebugSnapshot } from '../lib/ripmailExec.js'

const r = new Hono()

r.get('/children', (c) => {
  return c.json(getRipmailChildDebugSnapshot())
})

export default r
