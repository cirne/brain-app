import { describe, expect, it } from 'vitest'
import {
  wikiPrimaryCrumbsForDir,
  wikiPrimaryCrumbsForFile,
  wikiPrimaryCrumbsForMyWikiFile,
  wikiPrimaryCrumbsForSharedFile,
} from './wikiPrimaryBarCrumbs.js'

describe('wikiPrimaryCrumbsForFile', () => {
  it('empty path is wiki root label only', () => {
    expect(wikiPrimaryCrumbsForFile('')).toEqual([{ kind: 'tail', label: 'Wiki' }])
    expect(wikiPrimaryCrumbsForFile('  ')).toEqual([{ kind: 'tail', label: 'Wiki' }])
  })

  it('top-level file: Wiki → filename', () => {
    expect(wikiPrimaryCrumbsForFile('note.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'tail', label: 'note' },
    ])
  })

  it('nested file: Wiki → folder → page stem', () => {
    expect(wikiPrimaryCrumbsForFile('people/index.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'folder-link', path: 'people', label: 'people' },
      { kind: 'tail', label: 'index' },
    ])
  })

  it('deep path', () => {
    expect(wikiPrimaryCrumbsForFile('a/b/c/Page.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'folder-link', path: 'a', label: 'a' },
      { kind: 'folder-link', path: 'a/b', label: 'b' },
      { kind: 'folder-link', path: 'a/b/c', label: 'c' },
      { kind: 'tail', label: 'Page' },
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
  it('shared file: Wiki → @handle → folders → page', () => {
    expect(wikiPrimaryCrumbsForSharedFile('cirne', 'travel/trip.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'folder-link', path: '@cirne', label: '@cirne' },
      { kind: 'folder-link', path: '@cirne/travel', label: 'travel' },
      { kind: 'tail', label: 'trip' },
    ])
  })

  it('My Wiki file: Wiki → My Wiki → folders → page (`me` URL segment)', () => {
    expect(wikiPrimaryCrumbsForMyWikiFile('people/adam.md')).toEqual([
      { kind: 'wiki-root-link' },
      { kind: 'folder-link', path: 'me', label: 'My Wiki' },
      { kind: 'folder-link', path: 'me/people', label: 'people' },
      { kind: 'tail', label: 'adam' },
    ])
  })
})
