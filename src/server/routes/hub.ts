import { Hono } from 'hono'
import { getHubRipmailSourcesList, removeHubRipmailSource } from '@server/lib/hub/hubRipmailSources.js'
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
  const r = await spawnRipmailBackfillSource(id, since)
  if (!r.ok) {
    return c.json({ ok: false as const, error: r.error ?? 'spawn failed' }, 400)
  }
  return c.json({ ok: true as const })
})

export default hub
