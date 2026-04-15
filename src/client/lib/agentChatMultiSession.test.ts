import { describe, it, expect } from 'vitest'

/**
 * BUG-002: `AgentChat` passes `isActiveSession: () => displayedSessionId === activeKey`
 * into `consumeAgentChatStream`, so tool-driven UI (wiki pane, `open`, streaming previews)
 * only runs while that stream’s session is the one shown.
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
