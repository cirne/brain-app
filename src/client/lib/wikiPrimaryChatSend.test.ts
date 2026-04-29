import { describe, expect, it } from 'vitest'
import { wikiPrimaryChatMessageOrNull } from './wikiPrimaryChatSend.js'

describe('wikiPrimaryChatMessageOrNull', () => {
  it('returns null for blank input', () => {
    expect(wikiPrimaryChatMessageOrNull('')).toBeNull()
    expect(wikiPrimaryChatMessageOrNull('  \n')).toBeNull()
  })

  it('returns trimmed text', () => {
    expect(wikiPrimaryChatMessageOrNull('  hello  ')).toBe('hello')
  })
})
