import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  createNotification,
  listNotifications,
  patchNotificationState,
  type NotificationState,
} from '@server/lib/notifications/notificationsRepo.js'
import { presentationForNotificationRow } from '@shared/notifications/presentation.js'

const app = new Hono()

function parseState(s: string | undefined): NotificationState | undefined {
  if (s === 'unread' || s === 'read' || s === 'dismissed') return s
  return undefined
}

/** GET /api/notifications — optional query: state, limit */
app.get('/', (c: Context) => {
  const rawState = c.req.query('state')
  const state = parseState(rawState)
  const rawLimit = c.req.query('limit')
  let limit: number | undefined
  if (rawLimit != null && rawLimit !== '') {
    const n = Number.parseInt(rawLimit, 10)
    if (Number.isFinite(n) && n > 0) limit = n
  }
  const items = listNotifications({ state, limit })
  const enriched = items.map((row) => {
    const pres = presentationForNotificationRow({
      id: row.id,
      sourceKind: row.sourceKind,
      payload: row.payload,
    })
    return {
      ...row,
      summaryLine: pres.summaryLine,
      kickoffUserMessage: pres.kickoffUserMessage,
      kickoffHints: pres.kickoffHints,
    }
  })
  return c.json(enriched)
})

/** POST /api/notifications — body: { sourceKind, payload, state?, idempotencyKey?, id? } */
app.post('/', async (c: Context) => {
  const j = await c.req.json().catch(() => null)
  if (!j || typeof j !== 'object') {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const o = j as Record<string, unknown>
  const sourceKind = typeof o.sourceKind === 'string' ? o.sourceKind.trim() : ''
  if (!sourceKind) {
    return c.json({ error: 'sourceKind required' }, 400)
  }
  const state = parseState(typeof o.state === 'string' ? o.state : undefined)
  const row = createNotification({
    id: typeof o.id === 'string' ? o.id : undefined,
    sourceKind,
    payload: o.payload,
    state,
    idempotencyKey: typeof o.idempotencyKey === 'string' ? o.idempotencyKey : null,
  })
  return c.json(row)
})

/** PATCH /api/notifications/:id — body: { state } */
app.patch('/:id', async (c: Context) => {
  const id = c.req.param('id')?.trim()
  if (!id) {
    return c.json({ error: 'missing id' }, 400)
  }
  const j = await c.req.json().catch(() => null)
  if (!j || typeof j !== 'object') {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const o = j as Record<string, unknown>
  const state = parseState(typeof o.state === 'string' ? o.state : undefined)
  if (!state) {
    return c.json({ error: 'state required' }, 400)
  }
  const row = patchNotificationState(id, state)
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})

export default app
