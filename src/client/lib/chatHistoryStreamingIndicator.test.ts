import { describe, it, expect } from 'vitest'
import { chatRowShowsAgentWorking } from './chatHistoryStreamingIndicator.js'

describe('chatRowShowsAgentWorking', () => {
  const chat = { type: 'chat' as const, sessionId: 'a' }

  it('is true when the row session id is in the streaming set', () => {
    expect(chatRowShowsAgentWorking(chat, new Set(['a']))).toBe(true)
    expect(chatRowShowsAgentWorking(chat, new Set())).toBe(false)
    expect(chatRowShowsAgentWorking(chat, new Set(['b']))).toBe(false)
  })

  it('is false for non-chat rows', () => {
    expect(chatRowShowsAgentWorking({ type: 'email', sessionId: 'x' }, new Set(['x']))).toBe(false)
    expect(chatRowShowsAgentWorking({ type: 'doc', sessionId: 'x' }, new Set(['x']))).toBe(false)
  })
})
