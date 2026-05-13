import { randomUUID } from 'node:crypto'
import { notifyBrainTunnelActivity, notifyNotificationsChanged } from '@server/lib/hub/hubSseBroker.js'
import { getTenantDb } from '@server/lib/tenant/tenantSqlite.js'

const BRAIN_TUNNEL_SSE_SOURCE_KINDS = new Set([
  /** Owner: new collaborator question pending review */
  'b2b_inbound_query',
  /** Asker: owner approved / declined — outbound transcript updates */
  'b2b_tunnel_outbound_updated',
])

function tunnelActivitySsePayload(input: CreateNotificationInput): string | null {
  if (!BRAIN_TUNNEL_SSE_SOURCE_KINDS.has(input.sourceKind)) return null
  const p =
    input.payload != null && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  if (input.sourceKind === 'b2b_inbound_query') {
    return JSON.stringify({
      scope: 'inbox',
      inboundSessionId: typeof p.b2bSessionId === 'string' ? p.b2bSessionId : null,
      grantId: typeof p.grantId === 'string' ? p.grantId : null,
    })
  }
  return JSON.stringify({
    scope: 'outbound',
    outboundSessionId: typeof p.outboundSessionId === 'string' ? p.outboundSessionId : null,
    grantId: typeof p.grantId === 'string' ? p.grantId : null,
  })
}

export type NotificationState = 'unread' | 'read' | 'dismissed'

export type NotificationRow = {
  id: string
  sourceKind: string
  payload: unknown
  state: NotificationState
  idempotencyKey: string | null
  createdAtMs: number
  updatedAtMs: number
}

export type CreateNotificationInput = {
  /** Omit to assign a random UUID. */
  id?: string
  sourceKind: string
  payload: unknown
  state?: NotificationState
  idempotencyKey?: string | null
}

export function createNotification(input: CreateNotificationInput): NotificationRow {
  const db = getTenantDb()
  const now = Date.now()
  const id = input.id?.trim() || randomUUID()
  const state = input.state ?? 'unread'
  const payloadJson = JSON.stringify(input.payload ?? null)
  const idem = input.idempotencyKey?.trim() || null

  if (idem) {
    const existing = db
      .prepare(`SELECT id FROM notifications WHERE idempotency_key = ?`)
      .get(idem) as { id: string } | undefined
    if (existing) {
      const row = db
        .prepare(
          `SELECT id, source_kind, payload_json, state, idempotency_key, created_at_ms, updated_at_ms
           FROM notifications WHERE id = ?`,
        )
        .get(existing.id) as {
          id: string
          source_kind: string
          payload_json: string
          state: string
          idempotency_key: string | null
          created_at_ms: number
          updated_at_ms: number
      }
      return {
        id: row.id,
        sourceKind: row.source_kind,
        payload: JSON.parse(row.payload_json) as unknown,
        state: row.state as NotificationState,
        idempotencyKey: row.idempotency_key,
        createdAtMs: row.created_at_ms,
        updatedAtMs: row.updated_at_ms,
      }
    }
  }

  db.prepare(
    `INSERT INTO notifications (id, source_kind, payload_json, state, idempotency_key, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.sourceKind, payloadJson, state, idem, now, now)

  notifyNotificationsChanged()

  const sseData = tunnelActivitySsePayload(input)
  if (sseData !== null) {
    void notifyBrainTunnelActivity(sseData)
  }

  return {
    id,
    sourceKind: input.sourceKind,
    payload: input.payload ?? null,
    state,
    idempotencyKey: idem,
    createdAtMs: now,
    updatedAtMs: now,
  }
}

export type ListNotificationsParams = {
  state?: NotificationState
  limit?: number
}

export function listNotifications(params: ListNotificationsParams = {}): NotificationRow[] {
  const db = getTenantDb()
  const limit =
    typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0
      ? Math.min(Math.floor(params.limit), 500)
      : 500
  const state = params.state

  const rows =
    state !== undefined
      ? (db
          .prepare(
            `SELECT id, source_kind, payload_json, state, idempotency_key, created_at_ms, updated_at_ms
             FROM notifications WHERE state = ? ORDER BY created_at_ms DESC LIMIT ?`,
          )
          .all(state, limit) as {
          id: string
          source_kind: string
          payload_json: string
          state: string
          idempotency_key: string | null
          created_at_ms: number
          updated_at_ms: number
        }[])
      : (db
          .prepare(
            `SELECT id, source_kind, payload_json, state, idempotency_key, created_at_ms, updated_at_ms
             FROM notifications ORDER BY created_at_ms DESC LIMIT ?`,
          )
          .all(limit) as {
          id: string
          source_kind: string
          payload_json: string
          state: string
          idempotency_key: string | null
          created_at_ms: number
          updated_at_ms: number
        }[])

  return rows.map(r => ({
    id: r.id,
    sourceKind: r.source_kind,
    payload: JSON.parse(r.payload_json) as unknown,
    state: r.state as NotificationState,
    idempotencyKey: r.idempotency_key,
    createdAtMs: r.created_at_ms,
    updatedAtMs: r.updated_at_ms,
  }))
}

export function getNotificationByIdempotencyKey(idempotencyKey: string): NotificationRow | null {
  const db = getTenantDb()
  const idem = idempotencyKey.trim()
  if (!idem) return null
  const row = db
    .prepare(
      `SELECT id, source_kind, payload_json, state, idempotency_key, created_at_ms, updated_at_ms
       FROM notifications WHERE idempotency_key = ?`,
    )
    .get(idem) as
    | {
        id: string
        source_kind: string
        payload_json: string
        state: string
        idempotency_key: string | null
        created_at_ms: number
        updated_at_ms: number
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    sourceKind: row.source_kind,
    payload: JSON.parse(row.payload_json) as unknown,
    state: row.state as NotificationState,
    idempotencyKey: row.idempotency_key,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }
}

export function updateNotificationPayload(id: string, payload: unknown): NotificationRow | null {
  const db = getTenantDb()
  const now = Date.now()
  const payloadJson = JSON.stringify(payload ?? null)
  const r = db.prepare(`UPDATE notifications SET payload_json = ?, updated_at_ms = ? WHERE id = ?`).run(
    payloadJson,
    now,
    id,
  )
  if (r.changes === 0) return null
  notifyNotificationsChanged()
  return getNotificationById(id)
}

/** Updates kind + payload (e.g. upgrade `mail_notify` → `brain_query_mail` after sync enrichment). */
export function updateNotificationSourceKindAndPayload(
  id: string,
  sourceKind: string,
  payload: unknown,
): NotificationRow | null {
  const db = getTenantDb()
  const now = Date.now()
  const payloadJson = JSON.stringify(payload ?? null)
  const sk = sourceKind.trim()
  if (!sk) return null
  const r = db
    .prepare(`UPDATE notifications SET source_kind = ?, payload_json = ?, updated_at_ms = ? WHERE id = ?`)
    .run(sk, payloadJson, now, id)
  if (r.changes === 0) return null
  notifyNotificationsChanged()
  return getNotificationById(id)
}

export function getNotificationById(id: string): NotificationRow | null {
  const db = getTenantDb()
  const row = db
    .prepare(
      `SELECT id, source_kind, payload_json, state, idempotency_key, created_at_ms, updated_at_ms FROM notifications WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string
        source_kind: string
        payload_json: string
        state: string
        idempotency_key: string | null
        created_at_ms: number
        updated_at_ms: number
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    sourceKind: row.source_kind,
    payload: JSON.parse(row.payload_json) as unknown,
    state: row.state as NotificationState,
    idempotencyKey: row.idempotency_key,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }
}

export function patchNotificationState(id: string, state: NotificationState): NotificationRow | null {
  const db = getTenantDb()
  const now = Date.now()
  const r = db
    .prepare(`UPDATE notifications SET state = ?, updated_at_ms = ? WHERE id = ?`)
    .run(state, now, id)
  if (r.changes === 0) return null
  const row = db
    .prepare(
      `SELECT id, source_kind, payload_json, state, idempotency_key, created_at_ms, updated_at_ms FROM notifications WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string
        source_kind: string
        payload_json: string
        state: string
        idempotency_key: string | null
        created_at_ms: number
        updated_at_ms: number
      }
    | undefined
  if (!row) return null
  notifyNotificationsChanged()
  return {
    id: row.id,
    sourceKind: row.source_kind,
    payload: JSON.parse(row.payload_json) as unknown,
    state: row.state as NotificationState,
    idempotencyKey: row.idempotency_key,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }
}

/** Dev reset: remove all notification rows (tenant SQLite). */
export function deleteAllNotifications(): void {
  const db = getTenantDb()
  db.prepare(`DELETE FROM notifications`).run()
  notifyNotificationsChanged()
}
