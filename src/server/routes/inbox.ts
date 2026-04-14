import { Hono } from 'hono'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { extractDraftEdits } from '../lib/draftExtract.js'
import { buildDraftEditFlags } from '../agent/tools.js'
import { syncInboxRipmail } from '../lib/syncAll.js'
import { flattenInboxFromRipmailData } from '../lib/ripmailInboxFlatten.js'

const inbox = new Hono()
const execAsync = promisify(exec)

// Lazy so .env is loaded before first request
const ripmail = () => process.env.RIPMAIL_BIN ?? 'ripmail'

// GET /api/inbox — list inbox messages (via ripmail inbox)
inbox.get('/', async (c) => {
  try {
    const { stdout } = await execAsync(`${ripmail()} inbox`)
    const data = JSON.parse(stdout)
    const rows = flattenInboxFromRipmailData(data)
    return c.json(rows ?? [])
  } catch (err) {
    console.error('ripmail inbox error:', err)
    return c.json([], 200)
  }
})

// POST /api/inbox/sync — trigger IMAP sync
inbox.post('/sync', async (c) => {
  const result = await syncInboxRipmail()
  if (result.ok) return c.json({ ok: true })
  return c.json({ ok: false, error: result.error ?? 'inbox sync failed' }, 500)
})

// GET /api/inbox/who — contact autocomplete
inbox.get('/who', async (c) => {
  const q = c.req.query('q') ?? ''
  try {
    const cmd = q
      ? `${ripmail()} who ${JSON.stringify(q)} --limit 20`
      : `${ripmail()} who --limit 60`
    const { stdout } = await execAsync(cmd)
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
    const { stdout } = await execAsync(
      `${ripmail()} draft view ${JSON.stringify(draftId)} --with-body --json`
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
    await execAsync(
      `${ripmail()} draft edit ${JSON.stringify(draftId)} ${flags}-- ${JSON.stringify(bodyInstruction)}`,
      { timeout: 30000 }
    )
    const { stdout } = await execAsync(
      `${ripmail()} draft view ${JSON.stringify(draftId)} --with-body --json`
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
    await execAsync(`${ripmail()} send ${JSON.stringify(draftId)}`)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500)
  }
})

// GET /api/inbox/:id — read a message
inbox.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const { stdout } = await execAsync(`${ripmail()} read ${JSON.stringify(id)}`)
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
    const { stdout } = await execAsync(
      `${ripmail()} draft reply --message-id ${JSON.stringify(id)} --instruction ${JSON.stringify(instruction)} --with-body --json`
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
    const { stdout } = await execAsync(
      `${ripmail()} draft forward --message-id ${JSON.stringify(id)} --to ${JSON.stringify(to)} --instruction ${JSON.stringify(instruction)} --with-body --json`
    )
    return c.json(JSON.parse(stdout))
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// POST /api/inbox/:id/archive
inbox.post('/:id/archive', async (c) => {
  const id = c.req.param('id')
  await execAsync(`${ripmail()} archive ${id}`)
  return c.json({ ok: true })
})

// POST /api/inbox/:id/read
inbox.post('/:id/read', async (c) => {
  const id = c.req.param('id')
  await execAsync(`${ripmail()} read ${id}`)
  return c.json({ ok: true })
})

export default inbox
