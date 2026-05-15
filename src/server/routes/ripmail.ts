/**
 * Unified ripmail corpus entry resolver — mail vs indexed file (Drive / localDir).
 */
import { Hono } from 'hono'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { ripmailResolveEntryJson } from '@server/ripmail/index.js'

const ripmailApi = new Hono()

// GET /api/ripmail/entry/:id — discriminated union `{ entryKind: 'mail' | 'indexed-file', … }`
ripmailApi.get('/entry/:id', async (c) => {
  const id = c.req.param('id')?.trim()
  const source = c.req.query('source')?.trim()
  if (!id) return c.json({ error: 'missing id' }, 400)
  try {
    const payload = await ripmailResolveEntryJson(
      ripmailHomeForBrain(),
      id,
      source ? { sourceId: source } : undefined,
    )
    if (!payload) return c.json({ error: 'Not found' }, 404)
    return c.json(payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/ripmail/entry]', msg)
    return c.json({ error: msg }, 500)
  }
})

export default ripmailApi
