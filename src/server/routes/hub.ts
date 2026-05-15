import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import {
  browseHubRipmailFolders,
  getHubRipmailCalendarsForSource,
  getHubRipmailSourceDetail,
  getHubRipmailSourcesList,
  removeHubRipmailSource,
  updateHubRipmailCalendarIds,
  updateHubRipmailFileSource,
  updateIncludeSharedWithMe,
  type HubFileSourceConfig,
} from '@server/lib/hub/hubRipmailSources.js'
import { getHubSourceMailStatus } from '@server/lib/hub/hubRipmailSourceStatus.js'
import {
  isValidHubBackfillSince,
  spawnRipmailBackfillSource,
  spawnRipmailRefreshSource,
} from '@server/lib/hub/hubRipmailSpawn.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import {
  listImapSourcesWithVisibility,
  readDefaultSendSource,
  setDefaultSendSource,
  setSourceIncludeInDefault,
} from '@server/lib/platform/ripmailConfigEdit.js'

const hub = new Hono()

hub.get('/sources', async (c) => {
  const payload = await getHubRipmailSourcesList()
  return c.json(payload)
})

/** One source: config (TS `sourcesList`, CLI parity) + stats (`sourcesStatus`). */
hub.get('/sources/detail', async (c) => {
  const id = c.req.query('id')?.trim() ?? ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  const payload = await getHubRipmailSourceDetail(id)
  return c.json(payload)
})

hub.get('/sources/browse-folders', async (c) => {
  const id = c.req.query('id')?.trim() ?? ''
  const parentId = c.req.query('parentId')?.trim() ?? ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  const payload = await browseHubRipmailFolders(id, parentId || undefined)
  if (!payload.ok) {
    return c.json(payload, 400)
  }
  return c.json({ ok: true as const, folders: payload.folders })
})

hub.get('/sources/calendars', async (c) => {
  const id = c.req.query('id')?.trim() ?? ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  const r = await getHubRipmailCalendarsForSource(id)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error }, 400)
  }
  return c.json({ ok: true as const, allCalendars: r.allCalendars, configuredIds: r.configuredIds })
})

hub.post('/sources/update-calendar-ids', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; calendarIds?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  if (!Array.isArray(body.calendarIds) || body.calendarIds.length === 0) {
    return c.json({ ok: false as const, error: 'calendarIds (non-empty array) required' }, 400)
  }
  const calendarIds = (body.calendarIds as unknown[]).filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  )
  if (!calendarIds.length) {
    return c.json({ ok: false as const, error: 'no valid calendar IDs provided' }, 400)
  }
  const r = await updateHubRipmailCalendarIds(id, calendarIds)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error }, 400)
  }
  void spawnRipmailRefreshSource(id).catch(() => {})
  return c.json({ ok: true as const })
})

hub.post('/sources/update-file-source', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: unknown
    fileSource?: unknown
  }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  if (!body.fileSource || typeof body.fileSource !== 'object') {
    return c.json({ ok: false as const, error: 'fileSource required' }, 400)
  }
  const fs = body.fileSource as HubFileSourceConfig
  const r = await updateHubRipmailFileSource(id, fs)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error }, 400)
  }
  return c.json({ ok: true as const })
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
  // Same pattern as POST /api/inbox/sync: ripmail can run for RIPMAIL_REFRESH_TIMEOUT_MS — respond
  // immediately so Hub UI (mail + Drive) is not blocked for the full window.
  void spawnRipmailRefreshSource(id).then((r) => {
    if (!r.ok) {
      console.error('[hub/sources/refresh] ripmail refresh failed:', r.error ?? 'refresh failed')
    }
  })
  return c.json({ ok: true as const })
})

/**
 * Per-IMAP-source view of the search-default and send-default flags.
 * `mailboxes[].includeInDefault` controls whether `search_index` (no `source` filter) reaches it.
 * `defaultSendSource` is the source id used for `draft_email` / `send_draft` when nothing else
 * is specified.
 */
hub.get('/sources/mail-prefs', async (c) => {
  const ripmailHome = ripmailHomeForBrain()
  const mailboxes = await listImapSourcesWithVisibility(ripmailHome)
  const defaultSendSource = await readDefaultSendSource(ripmailHome)
  return c.json({
    ok: true as const,
    mailboxes,
    defaultSendSource,
  })
})

hub.post('/sources/include-in-default', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; included?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  if (typeof body.included !== 'boolean') {
    return c.json({ ok: false as const, error: 'included (boolean) required' }, 400)
  }
  const r = await setSourceIncludeInDefault(ripmailHomeForBrain(), id, body.included)
  if (!r.ok) {
    if (r.error === 'invalid_kind') {
      return c.json(
        { ok: false as const, error: 'Default-search visibility is for email accounts only.' },
        400,
      )
    }
    return c.json({ ok: false as const, error: 'Email account not found.' }, 404)
  }
  return c.json({ ok: true as const, id, includeInDefault: r.includeInDefault })
})

hub.post('/sources/default-send', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown }
  const idRaw = typeof body.id === 'string' ? body.id.trim() : ''
  const id = idRaw === '' ? null : idRaw
  const r = await setDefaultSendSource(ripmailHomeForBrain(), id)
  if (!r.ok) {
    if (r.error === 'invalid_kind') {
      return c.json(
        { ok: false as const, error: 'Default send is for email accounts only.' },
        400,
      )
    }
    return c.json({ ok: false as const, error: 'Email account not found.' }, 404)
  }
  return c.json({ ok: true as const, defaultSendSource: r.defaultSendSource })
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
  const jobId = randomUUID()
  void spawnRipmailBackfillSource(id, since).then((r) => {
    if (!r.ok) {
      console.error(
        `[hub/sources/backfill] jobId=${jobId} ripmail backfill failed:`,
        r.error ?? 'backfill failed',
      )
    }
  })
  return c.json({ ok: true as const, jobId })
})

hub.post('/sources/update-include-shared-with-me', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown; include?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return c.json({ ok: false as const, error: 'id required' }, 400)
  }
  if (typeof body.include !== 'boolean') {
    return c.json({ ok: false as const, error: 'include (boolean) required' }, 400)
  }
  const r = await updateIncludeSharedWithMe(id, body.include)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error }, 400)
  }
  return c.json({ ok: true as const })
})

export default hub
