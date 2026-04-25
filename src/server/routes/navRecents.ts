import { Hono } from 'hono'
import type { Context } from 'hono'
import type { NavRecentsItem, NavRecentsItemType } from '@server/lib/hub/navRecentsStore.js'
import {
  addNavRecentsItem,
  clearNavRecents,
  readNavRecents,
  removeNavRecentsItem,
  upsertEmailNavRecents,
} from '@server/lib/hub/navRecentsStore.js'

const app = new Hono()

function parseItemBody(j: unknown): Omit<NavRecentsItem, 'accessedAt'> | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const type = o.type as NavRecentsItemType
  const title = typeof o.title === 'string' ? o.title : ''
  if (!id || (type !== 'doc' && type !== 'email' && type !== 'chat')) return null
  if (!title.trim()) return null
  const path = typeof o.path === 'string' ? o.path : undefined
  const meta = typeof o.meta === 'string' ? o.meta : undefined
  return { id, type, title, path, meta }
}

/** GET /api/nav/recents */
app.get('/', async (c: Context) => {
  const items = await readNavRecents()
  return c.json(items)
})

/** POST /api/nav/recents — body: item to add/move to front */
app.post('/', async (c: Context) => {
  const j = await c.req.json().catch(() => null)
  const item = parseItemBody(j)
  if (!item) {
    return c.json({ error: 'Invalid item' }, 400)
  }
  await addNavRecentsItem(item)
  return c.json({ ok: true })
})

/** POST /api/nav/recents/upsert-email */
app.post('/upsert-email', async (c: Context) => {
  const j = (await c.req.json().catch(() => ({}))) as {
    threadId?: string
    subject?: string
    from?: string
  }
  const threadId = typeof j.threadId === 'string' ? j.threadId.trim() : ''
  const subject = typeof j.subject === 'string' ? j.subject : ''
  const from = typeof j.from === 'string' ? j.from : ''
  if (!threadId) {
    return c.json({ error: 'threadId required' }, 400)
  }
  const updated = await upsertEmailNavRecents(threadId, subject, from)
  return c.json({ ok: true, updated })
})

/** DELETE /api/nav/recents?id=<encoded> or DELETE ?all=1 (clear all) */
app.delete('/', async (c: Context) => {
  const id = c.req.query('id')
  const all = c.req.query('all')
  if (typeof id === 'string' && id.length > 0) {
    await removeNavRecentsItem(id)
    return c.json({ ok: true })
  }
  if (all === '1') {
    await clearNavRecents()
    return c.json({ ok: true })
  }
  return c.json({ error: 'Specify id or all=1' }, 400)
})

export default app
