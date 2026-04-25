import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'chat-test-'))
  process.env.BRAIN_HOME = brainHome
  const wikiDir = join(brainHome, 'wiki')
  await mkdir(join(wikiDir, 'ideas'), { recursive: true })
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome.')
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.resetModules()
})

describe('GET /api/chat/first-chat-pending', () => {
  it('returns pending false when marker missing', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat/first-chat-pending')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { pending: boolean }
    expect(j.pending).toBe(false)
  })

  it('returns pending true when marker exists', async () => {
    const { writeFirstChatPending } = await import('@server/lib/onboarding/firstChatPending.js')
    await writeFirstChatPending()

    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat/first-chat-pending')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { pending: boolean }
    expect(j.pending).toBe(true)
  })
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

  it('returns 400 for firstChatKickoff when first chat is not pending', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstChatKickoff: true, timezone: 'UTC' }),
    })
    expect(res.status).toBe(400)
    const err = (await res.json()) as { error?: string }
    expect(err.error).toContain('kickoff')
  })

  it('accepts firstChatKickoff when first-chat pending and session is empty', async () => {
    const { writeFirstChatPending } = await import('@server/lib/onboarding/firstChatPending.js')
    await writeFirstChatPending()

    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const sessionId = 'd10e8400-e29b-41d4-a716-446655440001'
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstChatKickoff: true, timezone: 'UTC', sessionId }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
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

  it('returns static assistant SSE for unknown slash command', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '/not_a_skill_xyz' }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Unknown skill')
    expect(text).toContain('not_a_skill_xyz')
  })
})

describe('POST /api/chat with context', () => {
  it('accepts a string context (surface context from AgentChat)', async () => {
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

  it('removes persisted session file when present', async () => {
    const sessionId = 'aa0e8400-e29b-41d4-a716-446655440099'
    const { appendTurn, loadSession } = await import('@server/lib/chat/chatStorage.js')
    await appendTurn({
      sessionId,
      userMessage: 'hi',
      assistantMessage: { role: 'assistant', content: '' },
    })
    expect(await loadSession(sessionId)).toBeTruthy()

    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request(`/api/chat/${sessionId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await loadSession(sessionId)).toBeNull()
  })
})

describe('GET /api/chat/sessions', () => {
  it('returns empty array when no chats', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat/sessions')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
  })

  it('returns session after appendTurn', async () => {
    const sessionId = 'bb0e8400-e29b-41d4-a716-446655440088'
    const { appendTurn } = await import('@server/lib/chat/chatStorage.js')
    await appendTurn({
      sessionId,
      userMessage: 'hello world',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'ok' }] },
      title: 'My chat',
    })

    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat/sessions')
    expect(res.status).toBe(200)
    const list = await res.json()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe(sessionId)
    expect(list[0].title).toBe('My chat')
    expect(list[0].preview).toContain('hello world')
  })

  it('respects limit query (newest first)', async () => {
    const { appendTurn } = await import('@server/lib/chat/chatStorage.js')
    const older = 'aa0e8400-e29b-41d4-a716-446655440099'
    const newer = 'bb0e8400-e29b-41d4-a716-44665544009a'
    await appendTurn({
      sessionId: older,
      userMessage: 'first',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'a' }] },
    })
    await new Promise((r) => setTimeout(r, 5))
    await appendTurn({
      sessionId: newer,
      userMessage: 'second',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'b' }] },
    })

    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat/sessions?limit=1')
    expect(res.status).toBe(200)
    const list = await res.json()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe(newer)
  })
})

describe('GET /api/chat/sessions/:sessionId', () => {
  it('returns 404 for unknown session', async () => {
    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request('/api/chat/sessions/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('returns full document', async () => {
    const sessionId = 'cc0e8400-e29b-41d4-a716-446655440077'
    const { appendTurn } = await import('@server/lib/chat/chatStorage.js')
    await appendTurn({
      sessionId,
      userMessage: 'q',
      assistantMessage: { role: 'assistant', content: '' },
    })

    const { default: chatRoute } = await import('./chat.js')
    const app = new Hono()
    app.route('/api/chat', chatRoute)

    const res = await app.request(`/api/chat/sessions/${sessionId}`)
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.sessionId).toBe(sessionId)
    expect(doc.messages).toHaveLength(2)
  })
})
