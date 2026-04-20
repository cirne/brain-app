import { describe, it, expect } from 'vitest'
import { buildImessageSnippet } from './imessageFormat.js'

describe('buildImessageSnippet', () => {
  it('builds a short snippet from compact rows', () => {
    const snippet = buildImessageSnippet([
      { sent_at_unix: 1, is_from_me: false, text: 'Hi', is_read: true },
      { sent_at_unix: 2, is_from_me: true, text: 'Hello there friend' },
    ])
    expect(snippet).toContain('Them: Hi')
    expect(snippet).toContain('You: Hello there friend')
  })
})
