import { describe, expect, it } from 'vitest'
import {
  listWikiDirChildren,
  mergeWikiBrowseChildPath,
  MY_WIKI_SEGMENT,
  MY_WIKI_URL_SEGMENT,
  normalizeWikiDirPath,
  parseUnifiedWikiBrowsePath,
  vaultRelativeDirFromWikiBrowseDir,
  vaultRelativeFromUnifiedWikiPath,
  wikiBrowseFolderDirIconKey,
  type WikiFileRow,
} from './wikiDirListModel.js'

const files: WikiFileRow[] = [
  { path: 'me.md', name: 'me' },
  { path: 'ideas/x.md', name: 'x' },
  { path: 'people/adam.md', name: 'adam' },
  { path: 'people/team/bob.md', name: 'bob' },
]

describe('wikiDirListModel (personal wiki)', () => {
  it('normalizeWikiDirPath', () => {
    expect(normalizeWikiDirPath(' a/b//c ')).toBe('a/b/c')
    expect(normalizeWikiDirPath(undefined)).toBe('')
  })

  it('parseUnifiedWikiBrowsePath strips legacy me/', () => {
    expect(parseUnifiedWikiBrowsePath('me/ideas/x.md')).toEqual({ vaultRelPath: 'ideas/x.md' })
    expect(parseUnifiedWikiBrowsePath('my-wiki/trips/a.md')).toEqual({ vaultRelPath: 'trips/a.md' })
    expect(parseUnifiedWikiBrowsePath('ideas/x.md')).toEqual({ vaultRelPath: 'ideas/x.md' })
  })

  it('vaultRelativeFromUnifiedWikiPath', () => {
    expect(vaultRelativeFromUnifiedWikiPath('me/ideas/x.md')).toBe('ideas/x.md')
    expect(vaultRelativeFromUnifiedWikiPath('ideas/x.md')).toBe('ideas/x.md')
  })

  it('vaultRelativeDirFromWikiBrowseDir', () => {
    expect(vaultRelativeDirFromWikiBrowseDir('me')).toBe(undefined)
    expect(vaultRelativeDirFromWikiBrowseDir('me/ideas')).toBe('ideas')
    expect(vaultRelativeDirFromWikiBrowseDir('ideas/sub')).toBe('ideas/sub')
  })

  it('mergeWikiBrowseChildPath', () => {
    expect(mergeWikiBrowseChildPath({ type: 'wiki-dir', path: 'ideas' }, 'note.md')).toBe('ideas/note.md')
    expect(mergeWikiBrowseChildPath({ type: 'wiki-dir' }, 'x')).toBe('x')
    expect(mergeWikiBrowseChildPath(null, 'me/a.md')).toBe('me/a.md')
  })

  it('wikiBrowseFolderDirIconKey', () => {
    expect(wikiBrowseFolderDirIconKey('me/people')).toBe('people')
    expect(wikiBrowseFolderDirIconKey('people')).toBe('people')
  })

  it('listWikiDirChildren at vault root', () => {
    const r = listWikiDirChildren(files, undefined)
    expect(r.filter((e) => e.kind === 'dir').map((e) => e.path)).toEqual(['ideas', 'people'])
    expect(r.filter((e) => e.kind === 'file').map((e) => e.path)).toEqual(['me.md'])
  })

  it('listWikiDirChildren nested folder', () => {
    const r = listWikiDirChildren(files, 'people')
    expect(r.map((e) => e.kind)).toEqual(['dir', 'file'])
    expect(r.find((e) => e.kind === 'dir')).toMatchObject({ path: 'people/team', label: 'team' })
    expect(r.find((e) => e.kind === 'file')).toMatchObject({ path: 'people/adam.md' })
  })
})

describe('MY_WIKI constants', () => {
  it('segments stay stable for crumbs', () => {
    expect(MY_WIKI_URL_SEGMENT).toBe('me')
    expect(MY_WIKI_SEGMENT).toBe('My Wiki')
  })
})
