import { describe, it, expect } from 'vitest'
import { wikiVaultPathDisplayName } from './wikiFileNameLabels.js'

describe('wikiVaultPathDisplayName', () => {
  it('matches WikiFileName title chip for nested pages', () => {
    expect(wikiVaultPathDisplayName('ideas/some-topic.md')).toBe('Some Topic')
  })

  it('uses folder segment for nested index paths', () => {
    expect(wikiVaultPathDisplayName('areas/notes/_index.md')).toBe('Notes')
  })

  it('handles vault root index', () => {
    expect(wikiVaultPathDisplayName('index.md')).toBe('My Wiki')
    expect(wikiVaultPathDisplayName('_index.md')).toBe('My Wiki')
  })

  it('profiles me.md root', () => {
    expect(wikiVaultPathDisplayName('me.md')).toBe('Me')
  })
})
