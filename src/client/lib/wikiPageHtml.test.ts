import { describe, expect, it } from 'vitest'
import {
  encodeWikiPathSegmentsForUrl,
  normalizeWikiPathForMatch,
  resolveWikiLinkToFilePath,
  transformWikiPageHtml,
} from './wikiPageHtml.js'

describe('encodeWikiPathSegmentsForUrl', () => {
  it('keeps slashes between segments (does not use %2F)', () => {
    expect(encodeWikiPathSegmentsForUrl('companies/gloo.md')).toBe('companies/gloo.md')
    expect(encodeWikiPathSegmentsForUrl('funds/trinity-ventures.md')).toBe('funds/trinity-ventures.md')
  })

  it('encodes special characters inside each segment', () => {
    expect(encodeWikiPathSegmentsForUrl('ideas/weird name.md')).toBe('ideas/weird%20name.md')
  })
})

describe('normalizeWikiPathForMatch', () => {
  it('strips .md and lowercases', () => {
    expect(normalizeWikiPathForMatch('Companies/New-Relic.MD')).toBe('companies/new-relic')
  })
})

describe('resolveWikiLinkToFilePath', () => {
  const files = [{ path: 'people/matt-shandera.md' }, { path: 'ideas/foo.md' }]

  it('resolves full normalized path', () => {
    expect(resolveWikiLinkToFilePath('people/matt-shandera', files)).toBe('people/matt-shandera.md')
  })

  it('resolves bare slug to nested file when unique', () => {
    expect(resolveWikiLinkToFilePath('matt-shandera', files)).toBe('people/matt-shandera.md')
  })

  it('returns null when no file matches', () => {
    expect(resolveWikiLinkToFilePath('missing-page', files)).toBeNull()
  })
})

describe('transformWikiPageHtml', () => {
  it('converts Obsidian [[path|label]] to data-wiki', () => {
    const h = transformWikiPageHtml('See [[ideas/foo|Foo idea]]')
    expect(h).toContain('data-wiki="ideas/foo"')
    expect(h).toContain('>Foo idea<')
  })

  it('converts marked wiki: href links to data-wiki (with .md in href)', () => {
    const h = transformWikiPageHtml(
      '<p>x <a href="wiki:companies/new-relic.md">New Relic</a> y</p>',
    )
    expect(h).not.toContain('href="wiki:')
    expect(h).toContain('data-wiki="companies/new-relic.md"')
    expect(h).toContain('>New Relic<')
  })

  it('appends .md when href has no extension', () => {
    const h = transformWikiPageHtml(
      '<a href="wiki:people/alice">Alice</a>',
    )
    expect(h).toContain('data-wiki="people/alice.md"')
  })
})
