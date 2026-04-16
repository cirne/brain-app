import { describe, it, expect } from 'vitest'
import { chatRowShowsAgentWorking } from './chatHistoryStreamingIndicator.js'

describe('chatRowShowsAgentWorking', () => {
  const chat = { type: 'chat' as const, sessionId: 'a' }

  it('is true only when the row is the active chat and streaming', () => {
    expect(chatRowShowsAgentWorking(chat, 'a', true)).toBe(true)
    expect(chatRowShowsAgentWorking(chat, 'a', false)).toBe(false)
    expect(chatRowShowsAgentWorking(chat, 'b', true)).toBe(false)
    expect(chatRowShowsAgentWorking(chat, null, true)).toBe(false)
  })

  it('is false for non-chat rows', () => {
    expect(chatRowShowsAgentWorking({ type: 'email', sessionId: 'x' }, 'x', true)).toBe(false)
    expect(chatRowShowsAgentWorking({ type: 'doc', sessionId: 'x' }, 'x', true)).toBe(false)
  })
})
