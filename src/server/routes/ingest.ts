import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  appendDeviceAudit,
  markDeviceTokenUsed,
  resolveDeviceTokenFromBearer,
} from '@server/lib/vault/deviceTokenAuth.js'
import {
  getImessageCursorForDevice,
  type IngestImessageRow,
  upsertImessageBatch,
  wipeImessageMessages,
} from '@server/lib/messages/messagesDb.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { brainHome } from '@server/lib/platform/brainHome.js'

const ingest = new Hono()

function toIngestRow(v: unknown): IngestImessageRow | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const guid = typeof r.guid === 'string' ? r.guid.trim() : ''
  const rowid = typeof r.rowid === 'number' ? r.rowid : Number(r.rowid)
  const dateMs = typeof r.date_ms === 'number' ? r.date_ms : Number(r.date_ms)
  if (!guid || !Number.isFinite(rowid) || !Number.isFinite(dateMs)) return null
  return {
    guid,
    rowid,
    date_ms: dateMs,
    text: typeof r.text === 'string' ? r.text : null,
    is_from_me: Boolean(r.is_from_me),
    handle: typeof r.handle === 'string' ? r.handle : null,
    chat_identifier: typeof r.chat_identifier === 'string' ? r.chat_identifier : null,
    display_name: typeof r.display_name === 'string' ? r.display_name : null,
    contact_identifier: typeof r.contact_identifier === 'string' ? r.contact_identifier : null,
    organization: typeof r.organization === 'string' ? r.organization : null,
    service: typeof r.service === 'string' ? r.service : 'iMessage',
  }
}

async function resolveIngestDeviceToken(c: Context) {
  const resolved = await resolveDeviceTokenFromBearer(c)
  if (!resolved) {
    return { error: c.json({ ok: false, error: 'invalid_device_token' }, 401) as Response }
  }
  if (!resolved.scopes.includes('ingest:imessage')) {
    return { error: c.json({ ok: false, error: 'device_scope_denied' }, 403) as Response }
  }
  return { resolved }
}

ingest.post('/imessage', async (c) => {
  const auth = await resolveIngestDeviceToken(c)
  if (auth.error) return auth.error
  const body = await c.req.json().catch(() => ({}))
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const bodyDeviceId = typeof payload.device_id === 'string' ? payload.device_id.trim() : ''
  const deviceId = bodyDeviceId || auth.resolved!.deviceId
  const rawBatch = Array.isArray(payload.batch) ? payload.batch : []
  const batch = rawBatch.map(toIngestRow).filter((row): row is IngestImessageRow => row != null)

  const result = await runWithTenantContextAsync(
    {
      tenantUserId: auth.resolved!.tenantUserId,
      workspaceHandle: auth.resolved!.tenantUserId,
      homeDir: auth.resolved!.homeDir,
    },
    async () => {
      const persisted = upsertImessageBatch(deviceId, batch)
      await markDeviceTokenUsed(auth.resolved!.homeDir, auth.resolved!.deviceId, {
        batchCount: batch.length,
      })
      return persisted
    },
  )

  return c.json({
    ok: true,
    accepted: result.accepted,
    last_rowid: result.lastRowid,
  })
})

ingest.get('/imessage/cursor', async (c) => {
  const auth = await resolveIngestDeviceToken(c)
  if (auth.error) return auth.error
  const requestedDevice = c.req.query('device_id')?.trim()
  const deviceId = requestedDevice && requestedDevice.length > 0 ? requestedDevice : auth.resolved!.deviceId

  const cursor = await runWithTenantContextAsync(
    {
      tenantUserId: auth.resolved!.tenantUserId,
      workspaceHandle: auth.resolved!.tenantUserId,
      homeDir: auth.resolved!.homeDir,
    },
    async () => {
      const value = getImessageCursorForDevice(deviceId)
      await markDeviceTokenUsed(auth.resolved!.homeDir, auth.resolved!.deviceId)
      return value
    },
  )

  return c.json({ ok: true, rowid: cursor })
})

ingest.post('/imessage/wipe', async (c) => {
  const deleted = wipeImessageMessages()
  await appendDeviceAudit(brainHome(), {
    action: 'wipe',
    batchCount: deleted,
  })
  return c.json({ ok: true, deleted })
})

export default ingest
