import { Hono } from 'hono'
import {
  ensureYourWikiRunning,
  pauseYourWiki,
  resumeYourWiki,
  requestLapNow,
  getYourWikiDoc,
} from '../agent/yourWikiSupervisor.js'

const yourWiki = new Hono()

/** Current supervisor state — single doc for the Your Wiki continuous loop. */
yourWiki.get('/', async (c) => {
  const doc = await getYourWikiDoc()
  return c.json(doc)
})

/** Pause the loop. */
yourWiki.post('/pause', async (c) => {
  await pauseYourWiki()
  const doc = await getYourWikiDoc()
  return c.json({ ok: true as const, doc })
})

/** Resume the loop (always starts a new lap at enriching). */
yourWiki.post('/resume', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  await resumeYourWiki({ timezone })
  const doc = await getYourWikiDoc()
  return c.json({ ok: true as const, doc })
})

/**
 * Wake from idle and start a lap immediately.
 * Only meaningful when the loop is idle or in backoff; no-op otherwise.
 */
yourWiki.post('/run-lap', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  await ensureYourWikiRunning({ timezone })
  requestLapNow()
  return c.json({ ok: true as const })
})

export default yourWiki
