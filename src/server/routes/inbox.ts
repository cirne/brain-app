import { Hono } from 'hono'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const inbox = new Hono()
const execAsync = promisify(exec)

const RIPMAIL = process.env.RIPMAIL_BIN ?? 'ripmail'

// GET /api/inbox — list inbox messages (via ripmail inbox)
inbox.get('/', async (c) => {
  try {
    const { stdout } = await execAsync(`${RIPMAIL} inbox --json`)
    return c.json(JSON.parse(stdout))
  } catch (err) {
    console.error('ripmail inbox error:', err)
    return c.json([], 200)
  }
})

// POST /api/inbox/sync — trigger IMAP sync
inbox.post('/sync', async (c) => {
  try {
    await execAsync(`${RIPMAIL} sync`)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500)
  }
})

// GET /api/inbox/:id — read a thread
inbox.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const { stdout } = await execAsync(`${RIPMAIL} thread ${id} --json`)
    return c.json(JSON.parse(stdout))
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// POST /api/inbox/:id/archive
inbox.post('/:id/archive', async (c) => {
  const id = c.req.param('id')
  await execAsync(`${RIPMAIL} archive ${id}`)
  return c.json({ ok: true })
})

// POST /api/inbox/:id/read
inbox.post('/:id/read', async (c) => {
  const id = c.req.param('id')
  await execAsync(`${RIPMAIL} read ${id}`)
  return c.json({ ok: true })
})

export default inbox
