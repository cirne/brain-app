import { Hono } from 'hono'
import { extractDraftEdits } from '@server/lib/llm/draftExtract.js'
import type { DraftEditExtraction } from '@server/lib/llm/draftExtract.js'
import { rewriteDraftBody } from '@server/lib/llm/draftBodyRewrite.js'
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
  ripmailReadMailForDisplay,
  ripmailArchive,
} from '@server/ripmail/index.js'
import { DraftSourceMessageNotFoundError, type EditDraftOptions } from '@server/ripmail/draft.js'

const inbox = new Hono()

function extractionToRipmailEdit(extracted: DraftEditExtraction): EditDraftOptions {
  const o: EditDraftOptions = {}
  if (extracted.subject !== undefined) o.subject = extracted.subject
  if (extracted.to !== undefined) o.to = extracted.to
  if (extracted.cc !== undefined) o.cc = extracted.cc
  if (extracted.bcc !== undefined) o.bcc = extracted.bcc
  if (extracted.add_to?.length) o.addTo = extracted.add_to
  if (extracted.add_cc?.length) o.addCc = extracted.add_cc
  if (extracted.add_bcc?.length) o.addBcc = extracted.add_bcc
  if (extracted.remove_to?.length) o.removeTo = extracted.remove_to
  if (extracted.remove_cc?.length) o.removeCc = extracted.remove_cc
  if (extracted.remove_bcc?.length) o.removeBcc = extracted.remove_bcc
  return o
}

function draftCreateErrorResponse(err: unknown): { error: string; status: 404 | 500 } {
  if (err instanceof DraftSourceMessageNotFoundError) {
    return { error: err.message, status: 404 }
  }
  return { error: err instanceof Error ? err.message : String(err), status: 500 }
}

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
    const result = await ripmailInbox(home, { since: '24h', thorough: false })
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
    const data = await ripmailWho(ripmailHomeForBrain(), q.trim() || undefined, { limit: q.trim() ? 20 : 60 })
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
      body: rec.body,
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

// POST /api/inbox/draft/:draftId/edit — structured extraction + optional body rewrite (LLM)
inbox.post('/draft/:draftId/edit', async (c) => {
  const draftId = c.req.param('draftId')
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const instruction =
    raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).instruction === 'string'
      ? (raw as Record<string, string>).instruction
      : ''
  const home = ripmailHomeForBrain()
  try {
    const current = ripmailDraftView(home, draftId)
    if (!current) return c.json({ error: 'Draft not found' }, 404)

    const extracted = await extractDraftEdits(instruction)
    const opts = extractionToRipmailEdit(extracted)
    const bodyInstr = extracted.body_instruction?.trim()
    if (bodyInstr) {
      if (!process.env.ANTHROPIC_API_KEY) {
        return c.json({ error: 'draft_body_rewrite_requires_llm' }, 503)
      }
      opts.body = await rewriteDraftBody(current.body, bodyInstr)
    }

    if (Object.keys(opts).length === 0) {
      return c.json(current)
    }

    ripmailDraftEdit(home, draftId, opts)
    const viewed = ripmailDraftView(home, draftId)
    return c.json(viewed ?? current)
  } catch (err) {
    brainLogger.error({ err }, '[inbox] draft refine failed')
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
    const msg = await ripmailReadMailForDisplay(home, id)
    if (!msg) return c.json({ error: 'Not found' }, 404)
    return c.json({
      messageId: msg.messageId,
      threadId: msg.threadId,
      headers: {
        from: msg.fromAddress,
        to: msg.toAddresses,
        cc: msg.ccAddresses,
        subject: msg.subject,
        date: msg.date,
      },
      bodyKind: msg.bodyKind,
      bodyText: msg.bodyText,
      ...(msg.bodyHtml ? { bodyHtml: msg.bodyHtml } : {}),
      ...(msg.visualArtifacts?.length ? { visualArtifacts: msg.visualArtifacts } : {}),
    })
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// POST /api/inbox/:id/reply — create reply draft
inbox.post('/:id/reply', async (c) => {
  const id = c.req.param('id')
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
  if (typeof rec.body !== 'string' || !rec.body.trim()) {
    return c.json({ error: 'body must be a non-empty string' }, 400)
  }
  let subjectArg: string | undefined
  let replyAllArg: boolean
  try {
    subjectArg = optionalSubject(rec.subject)
    if (rec.replyAll !== undefined && typeof rec.replyAll !== 'boolean') {
      return c.json({ error: 'replyAll must be a boolean' }, 400)
    }
    if (rec.reply_all !== undefined && typeof rec.reply_all !== 'boolean') {
      return c.json({ error: 'reply_all must be a boolean' }, 400)
    }
    replyAllArg = (rec.replyAll as boolean | undefined) ?? (rec.reply_all as boolean | undefined) ?? true
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
  try {
    const draft = await ripmailDraftReply(ripmailHomeForBrain(), {
      messageId: id,
      body: rec.body.trim(),
      subject: subjectArg,
      replyAll: replyAllArg,
    })
    return c.json(draft)
  } catch (err) {
    const { error, status } = draftCreateErrorResponse(err)
    return c.json({ error }, status)
  }
})

// POST /api/inbox/:id/forward — create forward draft
inbox.post('/:id/forward', async (c) => {
  const id = c.req.param('id')
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
  if (typeof rec.body !== 'string' || !rec.body.trim()) {
    return c.json({ error: 'body must be a non-empty string' }, 400)
  }
  if (typeof rec.to !== 'string' || !rec.to.trim()) {
    return c.json({ error: 'to must be a non-empty string' }, 400)
  }
  let subjectArg: string | undefined
  try {
    subjectArg = optionalSubject(rec.subject)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
  try {
    const draft = await ripmailDraftForward(ripmailHomeForBrain(), {
      messageId: id,
      to: rec.to.trim(),
      body: rec.body.trim(),
      subject: subjectArg,
    })
    return c.json(draft)
  } catch (err) {
    const { error, status } = draftCreateErrorResponse(err)
    return c.json({ error }, status)
  }
})

// POST /api/inbox/:id/archive
inbox.post('/:id/archive', async (c) => {
  const id = c.req.param('id')
  await ripmailArchive(ripmailHomeForBrain(), [id])
  return c.json({ ok: true })
})

// POST /api/inbox/:id/read
inbox.post('/:id/read', async (c) => {
  // Mark-as-read is a no-op in the TS module (tracked locally via UI state)
  return c.json({ ok: true })
})

export default inbox
