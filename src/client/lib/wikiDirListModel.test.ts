import { describe, it, expect } from 'vitest'
import {
  MY_WIKI_SEGMENT,
  MY_WIKI_URL_SEGMENT,
  listWikiDirChildren,
  listWikiDirChildrenWithShares,
  migrateLegacySharedWithMeDirPath,
  normalizeWikiDirPath,
  vaultPathHasOutgoingShare,
  wikiPathUnderSharePrefix,
  wikiShareCoversVaultPath,
} from './wikiDirListModel.js'

const files = [
  { path: 'me.md', name: 'me' },
  { path: 'people/adam.md', name: 'adam' },
  { path: 'people/team/bob.md', name: 'bob' },
  { path: 'ideas/x.md', name: 'x' },
]

const received = [
  {
    id: 'wsh_abc',
    ownerId: 'usr_1',
    ownerHandle: 'alice',
    pathPrefix: 'trips/',
    targetKind: 'dir' as const,
  },
]

describe('normalizeWikiDirPath', () => {
  it('trims slashes', () => {
    expect(normalizeWikiDirPath('/people/')).toBe('people')
    expect(normalizeWikiDirPath(undefined)).toBe('')
  })
})

describe('wikiShareCoversVaultPath / outgoing detection', () => {
  it('directory share covers folder root and descendants', () => {
    expect(wikiPathUnderSharePrefix('trips', 'trips/')).toBe(true)
    expect(wikiPathUnderSharePrefix('trips/beach.md', 'trips/')).toBe(true)
    expect(wikiPathUnderSharePrefix('other/me.md', 'trips/')).toBe(false)
  })

  it('file share covers exact path only', () => {
    expect(wikiShareCoversVaultPath('ideas/note.md', 'ideas/note.md', 'file')).toBe(true)
    expect(wikiShareCoversVaultPath('ideas/other.md', 'ideas/note.md', 'file')).toBe(false)
  })

  it('vaultPathHasOutgoingShare aggregates owned shares', () => {
    expect(
      vaultPathHasOutgoingShare('topics/a.md', [{ pathPrefix: 'topics/', targetKind: 'dir' }]),
    ).toBe(true)
    expect(vaultPathHasOutgoingShare('ideas/x.md', [{ pathPrefix: 'topics/', targetKind: 'dir' }])).toBe(
      false,
    )
  })
})

describe('migrateLegacySharedWithMeDirPath', () => {
  it('maps Shared-with-me tree to @handle', () => {
    expect(migrateLegacySharedWithMeDirPath('Shared with me')).toBe('')
    expect(migrateLegacySharedWithMeDirPath('Shared with me/bob')).toBe('@bob')
    expect(migrateLegacySharedWithMeDirPath('Shared with me/bob/wsh_abc')).toBe('@bob')
  })
})

describe('listWikiDirChildren', () => {
  it('lists root files and top-level dirs', () => {
    const r = listWikiDirChildren(files, undefined)
    expect(r.filter((e) => e.kind === 'dir').map((e) => e.label)).toEqual(['ideas', 'people'])
    expect(r.filter((e) => e.kind === 'file').map((e) => e.path)).toEqual(['me.md'])
  })

  it('lists files and subdirs inside a folder', () => {
    const r = listWikiDirChildren(files, 'people')
    expect(r.find((e) => e.kind === 'file' && e.path === 'people/adam.md')).toBeTruthy()
    expect(r.find((e) => e.kind === 'dir' && e.path === 'people/team')).toBeTruthy()
  })
})

describe('listWikiDirChildrenWithShares', () => {
  it('at vault root shows My Wiki then @handle rows (no flat local files)', () => {
    const r = listWikiDirChildrenWithShares(files, undefined, received)
    expect(r.map((e) => e.kind)).toEqual(['my-wiki-root', 'shared-owner'])
    expect(r[0]).toMatchObject({ kind: 'my-wiki-root', path: MY_WIKI_URL_SEGMENT, label: MY_WIKI_SEGMENT })
    expect(r[1]).toMatchObject({ kind: 'shared-owner', path: '@alice', ownerHandle: 'alice' })
  })

  it('inside My Wiki lists local subtree only', () => {
    const r = listWikiDirChildrenWithShares(files, MY_WIKI_SEGMENT, received)
    expect(r.find((e) => e.path === 'ideas')).toBeTruthy()
    expect(r.find((e) => e.kind === 'shared-owner')).toBeUndefined()
  })

  it('my-wiki URL segment lists same as My Wiki virtual folder', () => {
    const a = listWikiDirChildrenWithShares(files, MY_WIKI_URL_SEGMENT, received)
    const b = listWikiDirChildrenWithShares(files, MY_WIKI_SEGMENT, received)
    expect(a).toEqual(b)
  })

  it('with no shares, my-wiki virtual path lists vault root', () => {
    const r = listWikiDirChildrenWithShares(files, MY_WIKI_URL_SEGMENT, [])
    expect(r.find((e) => e.path === 'ideas')).toBeTruthy()
    expect(r.find((e) => e.path === 'people')).toBeTruthy()
  })
})
