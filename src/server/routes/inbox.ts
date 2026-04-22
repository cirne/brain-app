import { Hono } from 'hono'
import { extractDraftEdits } from '../lib/draftExtract.js'
import { buildDraftEditFlags } from '../agent/tools.js'
import { syncInboxRipmail } from '../lib/syncAll.js'
import { flattenInboxFromRipmailData } from '../lib/ripmailInboxFlatten.js'
import { execRipmailAsync, RIPMAIL_SEND_TIMEOUT_MS } from '../lib/ripmailExec.js'
import { ripmailReadExecOptions } from '../lib/ripmailReadExec.js'
import { ripmailBin } from '../lib/ripmailBin.js'

const inbox = new Hono()

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

// GET /api/inbox/:id — read a message
inbox.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const { stdout } = await execRipmailAsync(`${ripmailBin()} read ${JSON.stringify(id)}`, {
      ...ripmailReadExecOptions(),
    })
    return c.text(stdout)
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
