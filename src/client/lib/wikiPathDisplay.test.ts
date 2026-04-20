import { describe, it, expect } from 'vitest'
import { wikiPathParentDir } from './wikiPathDisplay.js'

describe('wikiPathParentDir', () => {
  it('returns null for top-level paths', () => {
    expect(wikiPathParentDir('me.md')).toBeNull()
    expect(wikiPathParentDir('index.md')).toBeNull()
  })

  it('returns parent folder for nested paths', () => {
    expect(wikiPathParentDir('ideas/foo.md')).toBe('ideas')
    expect(wikiPathParentDir('areas/notes/bar.md')).toBe('areas/notes')
  })

  it('normalizes slashes', () => {
    expect(wikiPathParentDir('ideas//foo.md')).toBe('ideas')
  })
})
