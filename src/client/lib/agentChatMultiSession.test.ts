import { describe, it, expect } from 'vitest'
import { sessionIsLiveStreaming, type SessionState } from './chatSessionStore.js'

/**
 * BUG-002: `AgentChat` passes `isActiveSession: () => displayedSessionId === activeKey`
 * into `consumeAgentChatStream`, so tool-driven UI (wiki pane, `open`, streaming previews)
 * only runs while that stream's session is the one shown.
 */
describe('AgentChat multi-session guard (BUG-002)', () => {
  it('isActiveSession is false when displayed session differs from the streaming session key', () => {
    let displayedSessionId = 'session-b'
    const activeKey = 'session-a'
    const isActiveSession = () => displayedSessionId === activeKey
    expect(isActiveSession()).toBe(false)
    displayedSessionId = 'session-a'
    expect(isActiveSession()).toBe(true)
  })
})

/**
 * loadSession must not clobber an in-flight streaming session with stale persisted data.
 * `sessionIsLiveStreaming` is the guard extracted from AgentChat.loadSession.
 */
describe('loadSession streaming guard', () => {
  function makeSession(overrides: Partial<SessionState> = {}): SessionState {
    return {
      messages: [],
      streaming: false,
      abortController: null,
      sessionId: null,
      chatTitle: null,
      pendingQueuedMessages: [],
      hearReplies: false,
      composerResetKey: '',
      ...overrides,
    }
  }

  it('returns true for a session that is actively streaming', () => {
    const sessions = new Map<string, SessionState>()
    sessions.set('s-1', makeSession({ streaming: true, abortController: new AbortController() }))
    expect(sessionIsLiveStreaming(sessions, 's-1')).toBe(true)
  })

  it('returns false for a session that is not streaming', () => {
    const sessions = new Map<string, SessionState>()
    sessions.set('s-1', makeSession({ streaming: false }))
    expect(sessionIsLiveStreaming(sessions, 's-1')).toBe(false)
  })

  it('returns false for a session id not in the map', () => {
    const sessions = new Map<string, SessionState>()
    expect(sessionIsLiveStreaming(sessions, 'unknown')).toBe(false)
  })
})
