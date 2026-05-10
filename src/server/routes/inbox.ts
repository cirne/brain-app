import { Hono } from 'hono'
import { extractDraftEdits } from '@server/lib/llm/draftExtract.js'
import { buildDraftEditFlags } from '../agent/tools.js'
import { syncInboxRipmail, syncInboxRipmailOnboarding } from '@server/lib/platform/syncAll.js'
import { readOnboardingStateDoc } from '@server/lib/onboarding/onboardingState.js'
import { flattenInboxFromRipmailData } from '@shared/ripmailInboxFlatten.js'
import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import {
  ripmailInbox,
  ripmailWho,
  ripmailDraftView,
  ripmailDraftEdit,
  ripmailDraftReply,
  ripmailDraftForward,
  ripmailSend,
  ripmailReadMail,
  ripmailArchive,
} from '@server/ripmail/index.js'

const inbox = new Hono()

function normalizeRecipients(label: string, v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length ? [t] : undefined
  }
  if (Array.isArray(v)) {
    const parts: string[] = []
    for (const x of v) {
      if (typeof x !== 'string') throw new Error(`${label} must be an array of strings`)
      const t = x.trim()
      if (t) parts.push(t)
    }
    return parts.length ? parts : undefined
  }
  throw new Error(`${label} must be a string or string array`)
}

function optionalSubject(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new Error('subject must be a string')
  const t = v.trim()
  return t.length ? t : undefined
}

// GET /api/inbox — list inbox messages
inbox.get('/', async (c) => {
  try {
    const home = ripmailHomeForBrain()
    const result = ripmailInbox(home, { since: '24h', thorough: false })
    // Build mailboxes format expected by flattenInboxFromRipmailData
    const data = { mailboxes: [{ id: 'default', items: result.items }] }
    const rows = flattenInboxFromRipmailData(data)
    return c.json(rows ?? [])
  } catch (err) {
    brainLogger.error({ err }, 'ripmail inbox error')
    return c.json({ ok: false as const, error: 'ripmail_unavailable' }, 503)
  }
})

// POST /api/inbox/sync — kick ripmail refresh; fire-and-forget.
inbox.post('/sync', async (c) => {
  const doc = await readOnboardingStateDoc()
  const isOnboardingSlice = doc.state === 'not-started' || doc.state === 'indexing'
  const syncFn = isOnboardingSlice ? syncInboxRipmailOnboarding : syncInboxRipmail
  void syncFn(undefined).then((result) => {
    if (!result.ok) {
      brainLogger.error({ err: result.error ?? 'inbox sync failed' }, '[inbox/sync] ripmail sync failed')
    }
  })
  return c.json({ ok: true })
})

/**
 * Global ripmail sync snapshot (all accounts).
 */
inbox.get('/mail-sync-status', async (c) => {
  return c.json(await getOnboardingMailStatus())
})

// GET /api/inbox/who — contact autocomplete
inbox.get('/who', async (c) => {
  const q = c.req.query('q') ?? ''
  try {
    const data = ripmailWho(ripmailHomeForBrain(), q.trim() || undefined, { limit: q.trim() ? 20 : 60 })
    return c.json(data.contacts ?? [])
  } catch {
    return c.json([])
  }
})

// GET /api/inbox/draft/:draftId — view a draft
inbox.get('/draft/:draftId', async (c) => {
  const draftId = c.req.param('draftId')
  try {
    const draft = ripmailDraftView(ripmailHomeForBrain(), draftId)
    if (!draft) return c.json({ error: 'Draft not found' }, 404)
    return c.json(draft)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// PATCH /api/inbox/draft/:draftId — literal body + headers (no LLM)
inbox.patch('/draft/:draftId', async (c) => {
  const draftId = c.req.param('draftId')
  let parsed: unknown
  try {
    parsed = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  if (!parsed || typeof parsed !== 'object') {
    return c.json({ error: 'expected JSON object' }, 400)
  }
  const rec = parsed as Record<string, unknown>
  if (typeof rec.body !== 'string') {
    return c.json({ error: 'body must be a string' }, 400)
  }
  let subjectArg: string | undefined
  let toArg: string[] | undefined
  let ccArg: string[] | undefined
  let bccArg: string[] | undefined
  try {
    subjectArg = optionalSubject(rec.subject)
    toArg = normalizeRecipients('to', rec.to)
    ccArg = normalizeRecipients('cc', rec.cc)
    bccArg = normalizeRecipients('bcc', rec.bcc)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
  try {
    const draft = ripmailDraftEdit(ripmailHomeForBrain(), draftId, {
      subject: subjectArg,
      to: toArg,
      cc: ccArg,
      bcc: bccArg,
    })
    return c.json(draft)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/draft/:draftId/edit — refine draft with LLM
inbox.post('/draft/:draftId/edit', async (c) => {
  const draftId = c.req.param('draftId')
  const { instruction } = await c.req.json()
  try {
    const extracted = await extractDraftEdits(instruction)
    const flags = buildDraftEditFlags(extracted)
    // Build edit options from extracted flags string
    const addCc = flags.includes('--add-cc') ? [] : undefined
    const removeCc = flags.includes('--remove-cc') ? [] : undefined
    const draft = ripmailDraftEdit(ripmailHomeForBrain(), draftId, {
      instruction: extracted.body_instruction ?? '',
      subject: extracted.subject ?? undefined,
      addCc,
      removeCc,
    })
    const viewed = ripmailDraftView(ripmailHomeForBrain(), draftId)
    return c.json(viewed ?? draft)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/draft/:draftId/send — send draft
inbox.post('/draft/:draftId/send', async (c) => {
  const draftId = c.req.param('draftId')
  try {
    await ripmailSend(ripmailHomeForBrain(), draftId)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500)
  }
})

// GET /api/inbox/:id — read a message
inbox.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const home = ripmailHomeForBrain()
    const msg = ripmailReadMail(home, id, { plainBody: true, fullBody: true })
    if (!msg) return c.json({ error: 'Not found' }, 404)
    const headersText = `From: ${msg.fromAddress}\nTo: ${msg.toAddresses.join(', ')}\nSubject: ${msg.subject}\nDate: ${msg.date}`
    const displayBody = msg.bodyText ?? ''
    return c.text(`${headersText}\n\n${displayBody}`)
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// POST /api/inbox/:id/reply — create reply draft
inbox.post('/:id/reply', async (c) => {
  const id = c.req.param('id')
  const { instruction } = await c.req.json()
  try {
    const draft = ripmailDraftReply(ripmailHomeForBrain(), { messageId: id, instruction })
    return c.json(draft)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/:id/forward — create forward draft
inbox.post('/:id/forward', async (c) => {
  const id = c.req.param('id')
  const { to, instruction } = await c.req.json()
  try {
    const draft = ripmailDraftForward(ripmailHomeForBrain(), { messageId: id, to, instruction })
    return c.json(draft)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/:id/archive
inbox.post('/:id/archive', async (c) => {
  const id = c.req.param('id')
  ripmailArchive(ripmailHomeForBrain(), [id])
  return c.json({ ok: true })
})

// POST /api/inbox/:id/read
inbox.post('/:id/read', async (c) => {
  // Mark-as-read is a no-op in the TS module (tracked locally via UI state)
  return c.json({ ok: true })
})

export default inbox
