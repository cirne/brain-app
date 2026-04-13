import { Hono } from 'hono'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const inbox = new Hono()
const execAsync = promisify(exec)

// Lazy so .env is loaded before first request
const ripmail = () => process.env.RIPMAIL_BIN ?? 'ripmail'

// GET /api/inbox — list inbox messages (via ripmail inbox)
inbox.get('/', async (c) => {
  try {
    const { stdout } = await execAsync(`${ripmail()} inbox`)
    const data = JSON.parse(stdout)
    const items = (data.mailboxes ?? []).flatMap((mb: any) =>
      (mb.items ?? []).map((item: any) => ({
        id: item.messageId,
        from: item.fromName || item.fromAddress,
        subject: item.subject,
        date: item.date,
        snippet: item.snippet,
        action: item.action,
        read: item.action !== 'notify',
      }))
    )
    return c.json(items)
  } catch (err) {
    console.error('ripmail inbox error:', err)
    return c.json([], 200)
  }
})

// POST /api/inbox/sync — trigger IMAP sync
inbox.post('/sync', async (c) => {
  try {
    await execAsync(`${ripmail()} sync`)
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
