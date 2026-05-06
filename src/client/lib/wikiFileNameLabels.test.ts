import { describe, it, expect } from 'vitest'
import { wikiVaultPathDisplayName } from './wikiFileNameLabels.js'

describe('wikiVaultPathDisplayName', () => {
  it('matches WikiFileName title chip for nested pages', () => {
    expect(wikiVaultPathDisplayName('ideas/some-topic.md')).toBe('Some Topic')
  })

  it('uses stored filename for nested index paths', () => {
    expect(wikiVaultPathDisplayName('areas/notes/_index.md')).toBe('_index.md')
    expect(wikiVaultPathDisplayName('me/index.md')).toBe('index.md')
  })

  it('handles vault root index', () => {
    expect(wikiVaultPathDisplayName('index.md')).toBe('My Wiki')
    expect(wikiVaultPathDisplayName('_index.md')).toBe('My Wiki')
  })

  it('profiles me.md root', () => {
    expect(wikiVaultPathDisplayName('me.md')).toBe('Me')
  })
})
