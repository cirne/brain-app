import { describe, it, expect } from 'vitest'
import {
  collectStreamingSessionIds,
  createPendingSessionKey,
  emptySession,
  migratePendingToServer,
  setSessionImmutable,
  touchSessionImmutable,
  deleteSessionImmutable,
} from './chatSessionStore.js'
import type { ChatMessage } from './agentUtils.js'

describe('chatSessionStore helpers', () => {
  it('createPendingSessionKey returns pending: prefix', () => {
    const k = createPendingSessionKey()
    expect(k.startsWith('pending:')).toBe(true)
  })

  it('migratePendingToServer moves state and updates displayed id', () => {
    const pending = 'pending:abc'
    const server = '11111111-1111-1111-1111-111111111111'
    const msg: ChatMessage = { role: 'user', content: 'hi' }
    let map = new Map()
    map = setSessionImmutable(map, pending, {
      ...emptySession(),
      messages: [msg],
      streaming: true,
      sessionId: null,
      chatTitle: 'T',
    })
    const r = migratePendingToServer(map, pending, server, pending)
    expect(r.sessions.has(pending)).toBe(false)
    expect(r.sessions.get(server)?.messages).toEqual([msg])
    expect(r.sessions.get(server)?.streaming).toBe(true)
    expect(r.sessions.get(server)?.sessionId).toBe(server)
    expect(r.displayedSessionId).toBe(server)
    expect(r.sessions.get(server)?.composerResetKey).toBe(pending)
  })

  it('migratePendingToServer carries pendingQueuedMessages onto server session (OPP-016)', () => {
    const pending = 'pending:q'
    const server = '44444444-4444-4444-4444-444444444444'
    let map = new Map()
    map = setSessionImmutable(map, pending, {
      ...emptySession(),
      messages: [{ role: 'user', content: 'a' }],
      streaming: true,
      sessionId: null,
      pendingQueuedMessages: ['follow up when done'],
    })
    const r = migratePendingToServer(map, pending, server, pending)
    expect(r.sessions.get(server)?.pendingQueuedMessages).toEqual(['follow up when done'])
  })

  it('migratePendingToServer merges pendingQueuedMessages when server slot exists', () => {
    const pending = 'pending:merge'
    const server = '55555555-5555-5555-5555-555555555555'
    let map = new Map()
    map = setSessionImmutable(map, server, {
      ...emptySession(),
      messages: [{ role: 'user', content: 'old' }],
      sessionId: server,
      pendingQueuedMessages: ['existing'],
    })
    map = setSessionImmutable(map, pending, {
      ...emptySession(),
      messages: [{ role: 'user', content: 'new' }],
      streaming: true,
      sessionId: null,
      pendingQueuedMessages: ['from pending'],
    })
    const r = migratePendingToServer(map, pending, server, pending)
    expect(r.sessions.get(server)?.pendingQueuedMessages).toEqual(['from pending', 'existing'])
  })

  it('migratePendingToServer leaves displayed id unchanged when viewing another session', () => {
    const pending = 'pending:p'
    const other = '22222222-2222-2222-2222-222222222222'
    const server = '33333333-3333-3333-3333-333333333333'
    let map = new Map()
    map = setSessionImmutable(map, other, {
      ...emptySession(),
      messages: [{ role: 'user', content: 'x' }],
      sessionId: other,
      chatTitle: null,
    })
    map = setSessionImmutable(map, pending, {
      ...emptySession(),
      messages: [{ role: 'user', content: 'y' }],
      streaming: true,
      sessionId: null,
      chatTitle: null,
    })
    const r = migratePendingToServer(map, pending, server, other)
    expect(r.displayedSessionId).toBe(other)
    expect(r.sessions.get(server)?.messages[0]?.content).toBe('y')
  })

  it('touchSessionImmutable patches one session', () => {
    let map = new Map()
    map = setSessionImmutable(map, 'a', emptySession())
    map = touchSessionImmutable(map, 'a', { chatTitle: 'Hi' })
    expect(map.get('a')?.chatTitle).toBe('Hi')
  })

  it('deleteSessionImmutable removes entry', () => {
    let map = new Map()
    map = setSessionImmutable(map, 'a', emptySession())
    map = deleteSessionImmutable(map, 'a')
    expect(map.has('a')).toBe(false)
  })

  it('collectStreamingSessionIds lists sessionId or map key for streaming sessions', () => {
    const sid = '11111111-1111-1111-1111-111111111111'
    let map = new Map()
    map = setSessionImmutable(map, sid, {
      ...emptySession(),
      streaming: true,
      sessionId: sid,
    })
    map = setSessionImmutable(map, 'pending:x', {
      ...emptySession(),
      streaming: true,
      sessionId: null,
    })
    map = setSessionImmutable(map, 'idle', emptySession())
    const ids = collectStreamingSessionIds(map)
    expect(ids.has(sid)).toBe(true)
    expect(ids.has('pending:x')).toBe(true)
    expect(ids.size).toBe(2)
  })
})
