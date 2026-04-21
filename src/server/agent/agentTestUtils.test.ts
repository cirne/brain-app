import { describe, it, expect } from 'vitest'
import { joinToolResultText, toolResultFirstText } from './agentTestUtils.js'

describe('agentTestUtils', () => {
  it('toolResultFirstText returns first text block', () => {
    expect(
      toolResultFirstText({
        content: [{ type: 'text', text: 'hello' }],
        details: {},
      })
    ).toBe('hello')
  })

  it('joinToolResultText skips non-text blocks', () => {
    expect(
      joinToolResultText({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
        details: {},
      })
    ).toBe('ab')
  })
})
