import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let wikiDir: string

beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'chat-test-'))
  await mkdir(join(wikiDir, 'ideas'))
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome.')
  process.env.WIKI_DIR = wikiDir
})

afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
  delete process.env.WIKI_DIR
  vi.resetModules()
})

describe('POST /api/chat', () => {
  it('returns 400 when message is missing', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('returns SSE stream with session event', async () => {
    // Without ANTHROPIC_API_KEY, the agent will error, but the SSE stream
    // should still start and send the session event before the error.
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    })
    expect(res.status).toBe(200)
    // SSE responses should have text/event-stream content type
    const contentType = res.headers.get('content-type')
    expect(contentType).toContain('text/event-stream')
  })
})

describe('POST /api/chat with context', () => {
  it('accepts a string context (surface context from AgentDrawer)', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'summarize this',
        context: 'The user is currently viewing this email (id: msg:123): "Budget" from alice@x.com.\n\nEmail content:\nPlease approve Q2.',
      }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('accepts a files object context (legacy wiki panel format)', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'summarize this',
        context: { files: ['index.md'] },
      }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })
})

describe('DELETE /api/chat/:sessionId', () => {
  it('returns ok when deleting a session', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat/nonexistent', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
