import { Hono } from 'hono'
import { getHubRipmailSourcesList, removeHubRipmailSource } from '../lib/hubRipmailSources.js'
import { getHubSourceMailStatus } from '../lib/hubRipmailSourceStatus.js'
import {
  isValidHubBackfillSince,
  spawnRipmailBackfillSource,
  spawnRipmailRefreshSource,
} from '../lib/hubRipmailSpawn.js'

const hub = new Hono()

hub.get('/sources', async (c) => {
  const payload = await getHubRipmailSourcesList()
  return c.json(payload)
})

hub.get('/sources/mail-status', async (c) => {
  const id = c.req.query('id')?.trim() ?? ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  const payload = await getHubSourceMailStatus(id)
  if (!payload.ok) {
    return c.json(payload, 200)
  }
  return c.json(payload)
})

hub.post('/sources/remove', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  const r = await removeHubRipmailSource(id)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error }, 400)
  }
  return c.json({ ok: true as const })
})

hub.post('/sources/refresh', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  const r = await spawnRipmailRefreshSource(id)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error ?? 'spawn failed' }, 400)
  }
  return c.json({ ok: true as const })
})

hub.post('/sources/backfill', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; since?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const sinceRaw = typeof body.since === 'string' ? body.since.trim() : ''
  const since = sinceRaw.length > 0 ? sinceRaw : '1y'
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  if (!isValidHubBackfillSince(since)) {
    return c.json({ ok: false as const, error: 'invalid backfill window' }, 400)
  }
  const r = await spawnRipmailBackfillSource(id, since)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error ?? 'spawn failed' }, 400)
  }
  return c.json({ ok: true as const })
})

export default hub
