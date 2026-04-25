import { describe, it, expect } from 'vitest'
import type { UserMessage } from '@mariozechner/pi-ai'
import { buildHearRepliesPromptMessages } from './hearRepliesPrompt.js'

describe('hearRepliesPrompt', () => {
  it('buildHearRepliesPromptMessages returns two user messages with app context first', () => {
    const msgs = buildHearRepliesPromptMessages('What is 2+2?')
    expect(msgs).toHaveLength(2)
    const u0 = msgs[0] as UserMessage
    const u1 = msgs[1] as UserMessage
    expect(u0.role).toBe('user')
    expect(u1.role).toBe('user')
    const t0 = Array.isArray(u0.content) ? u0.content[0] : null
    const t1 = Array.isArray(u1.content) ? u1.content[0] : null
    const ctx = t0 && 'text' in t0 ? t0.text : ''
    expect(ctx).toContain('Read answers aloud')
    expect(ctx).toMatch(/must call.*speak/i)
    expect(ctx).toMatch(/before.*main markdown|before you write your main/i)
    expect(t1 && 'text' in t1 ? t1.text : '').toBe('What is 2+2?')
  })
})
