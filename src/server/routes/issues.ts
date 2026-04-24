import { Hono } from 'hono'
import { brainHome } from '../lib/brainHome.js'
import { composeFeedbackIssueMarkdown } from '../lib/feedbackComposer.js'
import { getFeedbackIssueById, listFeedbackIssues, submitFeedbackMarkdown } from '../lib/feedbackIssues.js'

const issues = new Hono()

issues.get('/', async c => {
  const home = brainHome()
  const items = await listFeedbackIssues(home)
  return c.json({ issues: items })
})

issues.post('/draft', async c => {
  const body = await c.req.json().catch(() => ({}))
  const userMessage = typeof body.userMessage === 'string' ? body.userMessage : ''
  if (!userMessage.trim()) {
    return c.json({ error: 'userMessage is required' }, 400)
  }
  const transcript = typeof body.transcript === 'string' ? body.transcript : undefined
  const toolHints = typeof body.toolHints === 'string' ? body.toolHints : undefined
  const { markdown, error } = await composeFeedbackIssueMarkdown({ userMessage, transcript, toolHints })
  if (error || !markdown) {
    return c.json({ error: error ?? 'compose_failed' }, 502)
  }
  return c.json({ draft: markdown })
})

issues.post('/submit', async c => {
  const body = await c.req.json().catch(() => ({}))
  if (body.confirmed !== true) {
    return c.json({ error: 'confirmed_true_required' }, 400)
  }
  const markdown = typeof body.markdown === 'string' ? body.markdown : ''
  if (!markdown.trim()) {
    return c.json({ error: 'markdown is required' }, 400)
  }
  try {
    const out = await submitFeedbackMarkdown(markdown)
    return c.json({ ok: true, id: out.id, filename: out.filename, path: out.path })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'write_failed', message }, 500)
  }
})

issues.get('/:id', async c => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id < 1) {
    return c.json({ error: 'invalid_id' }, 400)
  }
  const home = brainHome()
  const found = await getFeedbackIssueById(home, id)
  if (!found) {
    return c.json({ error: 'not_found' }, 404)
  }
  return c.json({ id, content: found.content, path: found.path })
})

export default issues
