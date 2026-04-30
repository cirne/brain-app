import { writeFile, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { extractDraftEdits } from '@server/lib/llm/draftExtract.js'
import { buildDraftEditFlags } from '../agent/tools.js'
import { syncInboxRipmail } from '@server/lib/platform/syncAll.js'
import { flattenInboxFromRipmailData } from '@shared/ripmailInboxFlatten.js'
import { execRipmailAsync, execRipmailArgv, RIPMAIL_SEND_TIMEOUT_MS } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailReadExecOptions } from '@server/lib/ripmail/ripmailReadExec.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'

const inbox = new Hono()

function normalizeRecipients(label: string, v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length ? t : undefined
  }
  if (Array.isArray(v)) {
    const parts: string[] = []
    for (const x of v) {
      if (typeof x !== 'string') throw new Error(`${label} must be an array of strings`)
      const t = x.trim()
      if (t) parts.push(t)
    }
    return parts.length ? parts.join(',') : undefined
  }
  throw new Error(`${label} must be a string or string array`)
}

function optionalSubject(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new Error('subject must be a string')
  const t = v.trim()
  return t.length ? t : undefined
}

// GET /api/inbox — list inbox messages (via ripmail inbox)
inbox.get('/', async (c) => {
  try {
    const { stdout } = await execRipmailAsync(`${ripmailBin()} inbox`)
    const data = JSON.parse(stdout)
    const rows = flattenInboxFromRipmailData(data)
    return c.json(rows ?? [])
  } catch (err) {
    console.error('ripmail inbox error:', err)
    return c.json([], 200)
  }
})

// POST /api/inbox/sync — kick ripmail refresh (can run up to RIPMAIL_REFRESH_TIMEOUT_MS).
// Respond immediately so UIs (onboarding, inbox) are not blocked for the full refresh window.
inbox.post('/sync', (c) => {
  void syncInboxRipmail(undefined).then((result) => {
    if (!result.ok) {
      console.error('[inbox/sync] ripmail refresh failed:', result.error ?? 'inbox sync failed')
    }
  })
  return c.json({ ok: true })
})

/** Global ripmail sync snapshot (all accounts). Hub and post-onboarding UI use this — not onboarding-only. */
inbox.get('/mail-sync-status', async (c) => {
  return c.json(await getOnboardingMailStatus())
})

// GET /api/inbox/who — contact autocomplete
inbox.get('/who', async (c) => {
  const q = c.req.query('q') ?? ''
  try {
    const cmd = q
      ? `${ripmailBin()} who ${JSON.stringify(q)} --limit 20`
      : `${ripmailBin()} who --limit 60`
    const { stdout } = await execRipmailAsync(cmd)
    const data = JSON.parse(stdout)
    return c.json(data.people ?? [])
  } catch {
    return c.json([])
  }
})

// GET /api/inbox/draft/:draftId — view a draft
inbox.get('/draft/:draftId', async (c) => {
  const draftId = c.req.param('draftId')
  try {
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} draft view ${JSON.stringify(draftId)} --with-body --json`,
    )
    return c.json(JSON.parse(stdout))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// PATCH /api/inbox/draft/:draftId — literal body + headers via ripmail draft rewrite (no LLM)
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
  let subjectFlags: string | undefined
  let toCsv: string | undefined
  let ccCsv: string | undefined
  let bccCsv: string | undefined
  try {
    subjectFlags = optionalSubject(rec.subject)
    toCsv = normalizeRecipients('to', rec.to)
    ccCsv = normalizeRecipients('cc', rec.cc)
    bccCsv = normalizeRecipients('bcc', rec.bcc)
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }

  const tmpPath = join(tmpdir(), `brain-draft-${randomBytes(16).toString('hex')}.md`)
  try {
    await writeFile(tmpPath, rec.body, 'utf8')
    const argv = ['draft', 'rewrite', draftId, '--body-file', tmpPath, '--with-body', '--json']
    if (subjectFlags !== undefined) argv.push('--subject', subjectFlags)
    if (toCsv !== undefined) argv.push('--to', toCsv)
    if (ccCsv !== undefined) argv.push('--cc', ccCsv)
    if (bccCsv !== undefined) argv.push('--bcc', bccCsv)
    const { stdout } = await execRipmailArgv(argv, { timeout: 30_000 })
    const trimmed = stdout.trim()
    return c.json(JSON.parse(trimmed))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
})

// POST /api/inbox/draft/:draftId/edit — refine draft with LLM
// Accepts { instruction } — free-text is parsed by LLM to extract metadata
// changes (to/cc/bcc add/remove, subject) before passing to ripmail.
inbox.post('/draft/:draftId/edit', async (c) => {
  const draftId = c.req.param('draftId')
  const { instruction } = await c.req.json()
  try {
    const extracted = await extractDraftEdits(instruction)
    const flags = buildDraftEditFlags(extracted)
    const bodyInstruction = extracted.body_instruction ?? ''
    await execRipmailAsync(
      `${ripmailBin()} draft edit ${JSON.stringify(draftId)} ${flags}-- ${JSON.stringify(bodyInstruction)}`,
      { timeout: 30000 },
    )
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} draft view ${JSON.stringify(draftId)} --with-body --json`,
    )
    return c.json(JSON.parse(stdout))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/draft/:draftId/send — send draft
inbox.post('/draft/:draftId/send', async (c) => {
  const draftId = c.req.param('draftId')
  try {
    await execRipmailAsync(`${ripmailBin()} send ${JSON.stringify(draftId)}`, {
      timeout: RIPMAIL_SEND_TIMEOUT_MS,
    })
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500)
  }
})

// GET /api/inbox/:id — read a message (ripmail JSON; prefer raw `bodyHtml` for the iframe when present)
inbox.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} read ${JSON.stringify(id)} --json --full-body --include-html`,
      {
        ...ripmailReadExecOptions(),
      },
    )
    const trimmed = stdout.trim()
    let j: Record<string, unknown>
    try {
      j = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return c.json({ error: 'invalid ripmail json' }, 502)
    }
    const headersText = typeof j.headersText === 'string' ? j.headersText : ''
    const bodyText = typeof j.body === 'string' ? j.body : ''
    const bh = j.bodyHtml
    const bodyHtml = typeof bh === 'string' && bh.trim().length > 0 ? bh : ''
    const displayBody = bodyHtml || bodyText
    const out = `${headersText}\n\n${displayBody}`
    return c.text(out)
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// POST /api/inbox/:id/reply — create reply draft
inbox.post('/:id/reply', async (c) => {
  const id = c.req.param('id')
  const { instruction } = await c.req.json()
  try {
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} draft reply --message-id ${JSON.stringify(id)} --instruction ${JSON.stringify(instruction)} --with-body --json`,
    )
    return c.json(JSON.parse(stdout))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/:id/forward — create forward draft
inbox.post('/:id/forward', async (c) => {
  const id = c.req.param('id')
  const { to, instruction } = await c.req.json()
  try {
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} draft forward --message-id ${JSON.stringify(id)} --to ${JSON.stringify(to)} --instruction ${JSON.stringify(instruction)} --with-body --json`,
    )
    return c.json(JSON.parse(stdout))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/:id/archive
inbox.post('/:id/archive', async (c) => {
  const id = c.req.param('id')
  await execRipmailAsync(`${ripmailBin()} archive ${id}`)
  return c.json({ ok: true })
})

// POST /api/inbox/:id/read
inbox.post('/:id/read', async (c) => {
  const id = c.req.param('id')
  await execRipmailAsync(`${ripmailBin()} read ${id}`)
  return c.json({ ok: true })
})

export default inbox
