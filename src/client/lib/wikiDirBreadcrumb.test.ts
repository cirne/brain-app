import { describe, expect, it } from 'vitest'
import { parseWikiDirSegments, wikiDirPathPrefix } from './wikiDirBreadcrumb.js'

describe('parseWikiDirSegments', () => {
  it('returns [] for undefined', () => {
    expect(parseWikiDirSegments(undefined)).toEqual([])
  })

  it('splits a single folder', () => {
    expect(parseWikiDirSegments('projects')).toEqual(['projects'])
  })

  it('splits nested paths and trims', () => {
    expect(parseWikiDirSegments('a/b/c')).toEqual(['a', 'b', 'c'])
    expect(parseWikiDirSegments(' a / b ')).toEqual(['a', 'b'])
  })
})

describe('wikiDirPathPrefix', () => {
  it('builds path up to segment index', () => {
    const s = ['foo', 'bar', 'baz']
    expect(wikiDirPathPrefix(s, 0)).toBe('foo')
    expect(wikiDirPathPrefix(s, 1)).toBe('foo/bar')
    expect(wikiDirPathPrefix(s, 2)).toBe('foo/bar/baz')
  })
})
