import { describe, expect, it } from 'vitest'
import {
  encodeWikiPathSegmentsForUrl,
  normalizeWikiPathForMatch,
  resolveWikiLinkToFilePath,
  transformWikiPageHtml,
  wikiLinkRefFromAnchor,
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

describe('wikiLinkRefFromAnchor', () => {
  function anchor(attrs: Record<string, string>, textContent = ''): HTMLAnchorElement {
    const map = new Map(Object.entries(attrs))
    return {
      getAttribute(name: string) {
        return map.get(name) ?? null
      },
      textContent,
    } as HTMLAnchorElement
  }

  it('reads data-wiki', () => {
    const a = anchor({ 'data-wiki': 'ideas/foo.md', href: '#' })
    expect(wikiLinkRefFromAnchor(a)).toBe('ideas/foo.md')
  })

  it('reads relative wiki href', () => {
    const a = anchor({ href: 'people/bob.md' })
    expect(wikiLinkRefFromAnchor(a)).toBe('people/bob.md')
  })

  it('returns null for https links', () => {
    const a = anchor({ href: 'https://example.com' })
    expect(wikiLinkRefFromAnchor(a)).toBeNull()
  })

  it('infers from label when href is hash-only', () => {
    const a = anchor({ href: '#' }, 'some slug-title')
    expect(wikiLinkRefFromAnchor(a)).toBe('some-slug-title.md')
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

  it('maps [[me]] to root me.md, not another file whose basename is me', () => {
    const nestedOnly = [{ path: 'themes/me.md' }]
    expect(resolveWikiLinkToFilePath('me', nestedOnly)).toBe('me.md')
    const both = [{ path: 'me.md' }, { path: 'themes/me.md' }]
    expect(resolveWikiLinkToFilePath('me', both)).toBe('me.md')
  })
})

describe('transformWikiPageHtml', () => {
  it('converts Obsidian [[path|label]] to data-wiki with .md', () => {
    const h = transformWikiPageHtml('See [[ideas/foo|Foo idea]]')
    expect(h).toContain('data-wiki="ideas/foo.md"')
    expect(h).toContain('>Foo idea<')
  })

  it('converts [[me]] to root me.md', () => {
    const h = transformWikiPageHtml('Profile: [[me]]')
    expect(h).toContain('data-wiki="me.md"')
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

  it('converts marked relative `[label](ideas/foo.md)` anchors to data-wiki', () => {
    const h = transformWikiPageHtml('<p><a href="ideas/foo.md">Foo</a></p>')
    expect(h).toContain('data-wiki="ideas/foo.md"')
    expect(h).not.toContain('href="ideas/')
  })

  it('converts `[label](me)` style anchors (href without .md or wiki: prefix)', () => {
    const h = transformWikiPageHtml('<p><a href="me">me</a></p>')
    expect(h).toContain('data-wiki="me.md"')
    expect(h).toContain('class="wiki-link"')
  })

  it('converts anchors when href precedes other attributes', () => {
    const h = transformWikiPageHtml(
      '<p><a class="x" href="./people/bob.md">Bob</a></p>',
    )
    expect(h).toContain('data-wiki="people/bob.md"')
  })

  it('reads href with single quotes', () => {
    const h = transformWikiPageHtml("<p><a href='people/ann.md'>Ann</a></p>")
    expect(h).toContain('data-wiki="people/ann.md"')
  })

  it('converts raw HTML `<a href="#">slug</a>` to data-wiki from text', () => {
    const h = transformWikiPageHtml('<ul><li><p><a href="#">people/lewis-cirne</a></p></li></ul>')
    expect(h).toContain('data-wiki="people/lewis-cirne.md"')
    expect(h).toContain('class="wiki-link"')
  })
})
