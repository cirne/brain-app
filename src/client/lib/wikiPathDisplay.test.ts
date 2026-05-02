import { describe, it, expect } from 'vitest'
import {
  isWikiRootIndexPath,
  resolveWikiRootIndexPath,
  wikiPathParentDir,
  wikiShareVaultPathForWikiFileName,
} from './wikiPathDisplay.js'

describe('resolveWikiRootIndexPath', () => {
  it('prefers root _index.md over root index.md', () => {
    expect(
      resolveWikiRootIndexPath([
        { path: 'index.md', name: 'index' },
        { path: '_index.md', name: '_index' },
      ]),
    ).toBe('_index.md')
  })

  it('falls back to root index.md', () => {
    expect(resolveWikiRootIndexPath([{ path: 'index.md', name: 'index' }])).toBe('index.md')
  })

  it('ignores nested index files', () => {
    expect(
      resolveWikiRootIndexPath([
        { path: 'ideas/_index.md', name: '_index' },
        { path: 'index.md', name: 'index' },
      ]),
    ).toBe('index.md')
  })

  it('does not use me.md as wiki landing (use hub profile link for that)', () => {
    expect(resolveWikiRootIndexPath([{ path: 'me.md', name: 'me' }])).toBeNull()
  })

  it('skips me.md when picking first root page', () => {
    expect(
      resolveWikiRootIndexPath([
        { path: 'me.md', name: 'me' },
        { path: 'topics.md', name: 'topics' },
      ]),
    ).toBe('topics.md')
  })

  it('matches Index.md case-insensitively', () => {
    expect(resolveWikiRootIndexPath([{ path: 'Index.md', name: 'Index' }])).toBe('Index.md')
  })

  it('falls back to first root md excluding _log.md', () => {
    expect(
      resolveWikiRootIndexPath([
        { path: '_log.md', name: '_log' },
        { path: 'zebra.md', name: 'zebra' },
        { path: 'alpha.md', name: 'alpha' },
      ]),
    ).toBe('alpha.md')
  })

  it('returns null when wiki has no md files', () => {
    expect(resolveWikiRootIndexPath([])).toBeNull()
  })
})

describe('isWikiRootIndexPath', () => {
  it('is true for root index.md variants', () => {
    expect(isWikiRootIndexPath('index.md')).toBe(true)
    expect(isWikiRootIndexPath('Index.md')).toBe(true)
    expect(isWikiRootIndexPath('_index.md')).toBe(true)
  })

  it('is false for nested index files', () => {
    expect(isWikiRootIndexPath('ideas/index.md')).toBe(false)
    expect(isWikiRootIndexPath('ideas/_index.md')).toBe(false)
  })

  it('is false for other root pages', () => {
    expect(isWikiRootIndexPath('me.md')).toBe(false)
    expect(isWikiRootIndexPath('topics.md')).toBe(false)
  })

  it('normalizes slashes and ignores non-md', () => {
    expect(isWikiRootIndexPath('/index.md')).toBe(true)
    expect(isWikiRootIndexPath('index')).toBe(false)
  })
})

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

describe('wikiShareVaultPathForWikiFileName', () => {
  it('returns file prefixes as vault paths', () => {
    expect(
      wikiShareVaultPathForWikiFileName({
        pathPrefix: 'travel/virginia-trip-2026.md',
        targetKind: 'file',
      }),
    ).toBe('travel/virginia-trip-2026.md')
  })

  it('maps directory prefixes to synthetic index paths', () => {
    expect(wikiShareVaultPathForWikiFileName({ pathPrefix: 'trips/', targetKind: 'dir' })).toBe(
      'trips/index.md',
    )
    expect(wikiShareVaultPathForWikiFileName({ pathPrefix: '', targetKind: 'dir' })).toBe('index.md')
  })
})
