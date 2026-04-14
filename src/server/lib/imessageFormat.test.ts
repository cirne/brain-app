import { describe, it, expect } from 'vitest'
import { buildImessageSnippet } from './imessageFormat.js'

describe('buildImessageSnippet', () => {
  it('builds a short snippet from compact rows', () => {
    const snippet = buildImessageSnippet([
      { ts: 1, m: 0, t: 'Hi', r: 1 },
      { ts: 2, m: 1, t: 'Hello there friend' },
    ])
    expect(snippet).toContain('Them: Hi')
    expect(snippet).toContain('You: Hello there friend')
  })
})
