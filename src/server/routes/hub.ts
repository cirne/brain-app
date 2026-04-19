import { Hono } from 'hono'
import { getHubRipmailSourcesList, removeHubRipmailSource } from '../lib/hubRipmailSources.js'

const hub = new Hono()

hub.get('/sources', async (c) => {
  const payload = await getHubRipmailSourcesList()
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

export default hub
