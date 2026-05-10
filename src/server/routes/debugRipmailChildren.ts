import { Hono } from 'hono'

const r = new Hono()

/** No subprocess children — ripmail runs in-process (OPP-103). */
r.get('/children', (c) => {
  return c.json({ inFlight: 0, spawnCount: 0, closeCount: 0, timeoutKillCount: 0, pids: [] })
})

export default r
