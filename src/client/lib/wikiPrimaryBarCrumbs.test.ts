import { describe, expect, it } from 'vitest'
import {
  wikiPrimaryCrumbsForDir,
  wikiPrimaryCrumbsForFile,
  wikiPrimaryCrumbsForMyWikiFile,
  wikiPrimaryCrumbsForOverlay,
  wikiPrimaryCrumbMenuIcon,
  wikiPrimaryCrumbsForSharedFile,
} from './wikiPrimaryBarCrumbs.js'

describe('wikiPrimaryCrumbsForFile', () => {
  it('empty path is wiki root label only', () => {
    expect(wikiPrimaryCrumbsForFile('')).toEqual([{ kind: 'tail', label: 'Wiki' }])
    expect(wikiPrimaryCrumbsForFile('  ')).toEqual([{ kind: 'tail', label: 'Wiki' }])
  })

  it('top-level file: Wiki → filename.md', () => {
    expect(wikiPrimaryCrumbsForFile('note.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'tail', label: 'note.md' },
    ])
  })

  it('nested file: Wiki → folder → page filename', () => {
    expect(wikiPrimaryCrumbsForFile('people/index.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'folder-link', path: 'people', label: 'people' },
      { kind: 'tail', label: 'index.md' },
    ])
  })

  it('deep path', () => {
    expect(wikiPrimaryCrumbsForFile('a/b/c/Page.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'folder-link', path: 'a', label: 'a' },
      { kind: 'folder-link', path: 'a/b', label: 'b' },
      { kind: 'folder-link', path: 'a/b/c', label: 'c' },
      { kind: 'tail', label: 'Page.md' },
    ])
  })
})

describe('wikiPrimaryCrumbsForDir', () => {
  it('undefined path is wiki root only', () => {
    expect(wikiPrimaryCrumbsForDir(undefined)).toEqual([{ kind: 'tail', label: 'Wiki' }])
  })

  it('single folder', () => {
    expect(wikiPrimaryCrumbsForDir('people')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'tail', label: 'people' },
    ])
  })

  it('nested folders', () => {
    expect(wikiPrimaryCrumbsForDir('people/notes')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'folder-link', path: 'people', label: 'people' },
      { kind: 'tail', label: 'notes' },
    ])
  })
})

describe('wikiPrimaryCrumbs shared / My Wiki', () => {
  it('shared file: @handle → folders → page', () => {
    expect(wikiPrimaryCrumbsForSharedFile('cirne', 'travel/trip.md')).toEqual([
      { kind: 'folder-link', path: '@cirne', label: '@cirne' },
      { kind: 'folder-link', path: '@cirne/travel', label: 'travel' },
      { kind: 'tail', label: 'trip.md' },
    ])
  })

  it('My Wiki file: My Wiki → folders → page (`me` URL segment)', () => {
    expect(wikiPrimaryCrumbsForMyWikiFile('people/adam.md')).toEqual([
      { kind: 'folder-link', path: 'me', label: 'My Wiki' },
      { kind: 'folder-link', path: 'me/people', label: 'people' },
      { kind: 'tail', label: 'adam.md' },
    ])
  })
})

describe('wikiPrimaryCrumbsForOverlay', () => {
  it('maps personal unified reader path (no wiki hub crumb)', () => {
    expect(
      wikiPrimaryCrumbsForOverlay({ type: 'wiki', path: 'me/people/joshua-cano.md' }),
    ).toEqual([
      { kind: 'folder-link', path: 'me', label: 'My Wiki' },
      { kind: 'folder-link', path: 'me/people', label: 'people' },
      { kind: 'tail', label: 'joshua-cano.md' },
    ])
  })

  it('vault-relative reader path uses vault crumbs', () => {
    expect(wikiPrimaryCrumbsForOverlay({ type: 'wiki', path: 'travel.md' })).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'tail', label: 'travel.md' },
    ])
  })
})

describe('wikiPrimaryCrumbMenuIcon', () => {
  it('maps browse roots and nested dirs', () => {
    expect(wikiPrimaryCrumbMenuIcon({ kind: 'wiki-root-link' })).toEqual({ kind: 'book-open' })
    expect(wikiPrimaryCrumbMenuIcon({ kind: 'folder-link', path: 'me', label: 'My Wiki' })).toEqual({
      kind: 'book-open',
    })
    expect(wikiPrimaryCrumbMenuIcon({ kind: 'folder-link', path: '@alice', label: '@alice' })).toEqual({
      kind: 'users',
    })
    expect(
      wikiPrimaryCrumbMenuIcon({ kind: 'folder-link', path: 'me/people', label: 'people' }),
    ).toEqual({ kind: 'dir', key: 'people' })
  })
})
