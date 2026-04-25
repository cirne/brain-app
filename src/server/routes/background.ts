import { Hono } from 'hono'
import { listBackgroundRuns, readBackgroundRun } from '@server/lib/chat/backgroundAgentStore.js'
import {
  pauseWikiExpansionRun,
  resumeWikiExpansionRun,
} from '../agent/wikiExpansionRunner.js'

const background = new Hono()

background.get('/agents', async (c) => {
  const runs = await listBackgroundRuns()
  return c.json({ agents: runs })
})

background.get('/agents/:id', async (c) => {
  const id = c.req.param('id')
  const doc = await readBackgroundRun(id)
  if (!doc) return c.json({ error: 'Not found' }, 404)
  return c.json(doc)
})

background.post('/agents/:id/pause', async (c) => {
  const id = c.req.param('id')
  const doc = await readBackgroundRun(id)
  if (!doc) return c.json({ error: 'Not found' }, 404)
  if (doc.kind !== 'wiki-expansion') return c.json({ error: 'Unsupported kind' }, 400)
  pauseWikiExpansionRun(id)
  return c.json({ ok: true as const })
})

background.post('/agents/:id/resume', async (c) => {
  const id = c.req.param('id')
  const doc = await readBackgroundRun(id)
  if (!doc) return c.json({ error: 'Not found' }, 404)
  if (doc.kind !== 'wiki-expansion') return c.json({ error: 'Unsupported kind' }, 400)
  const body = await c.req.json().catch(() => ({}))
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  await resumeWikiExpansionRun(id, { timezone })
  return c.json({ ok: true as const })
})

export default background
