import { describe, it, expect } from 'vitest'
import {
  MY_WIKI_SEGMENT,
  MY_WIKI_URL_SEGMENT,
  countOutgoingSharesForVaultPath,
  listWikiDirChildren,
  listWikiDirChildrenWithShares,
  mergeWikiBrowseChildPath,
  migrateLegacySharedWithMeDirPath,
  normalizeWikiDirPath,
  parseUnifiedWikiBrowsePath,
  wikiBrowseFolderDirIconKey,
  vaultPathHasOutgoingShare,
  wikiPathUnderSharePrefix,
  wikiShareCoversVaultPath,
} from './wikiDirListModel.js'

const files = [
  { path: 'me/me.md', name: 'me' },
  { path: 'me/people/adam.md', name: 'adam' },
  { path: 'me/people/team/bob.md', name: 'bob' },
  { path: 'me/ideas/x.md', name: 'x' },
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

describe('mergeWikiBrowseChildPath', () => {
  const sharedDirOverlay = { type: 'wiki-dir' as const, shareHandle: 'cirne' }

  it('prefixes @handle when browsing a share and opening an owner-relative folder', () => {
    expect(mergeWikiBrowseChildPath(sharedDirOverlay, 'travel')).toBe('@cirne/travel')
  })

  it('prefixes deeper owner-relative paths', () => {
    expect(mergeWikiBrowseChildPath(sharedDirOverlay, 'travel/europe.md')).toBe('@cirne/travel/europe.md')
  })

  it('does not double-wrap paths that already use @handle', () => {
    expect(mergeWikiBrowseChildPath(sharedDirOverlay, '@cirne/travel')).toBe('@cirne/travel')
  })

  it('returns undefined when child omitted', () => {
    expect(mergeWikiBrowseChildPath(sharedDirOverlay, undefined)).toBeUndefined()
  })

  it('returns empty when child blank', () => {
    expect(mergeWikiBrowseChildPath(sharedDirOverlay, '   ')).toBe('')
  })

  it('no-op when parent is not wiki-dir', () => {
    expect(mergeWikiBrowseChildPath({ type: 'wiki', shareHandle: 'cirne' }, 'travel')).toBe('travel')
  })

  it('no-op when wiki-dir has no shareHandle', () => {
    expect(mergeWikiBrowseChildPath({ type: 'wiki-dir' }, 'travel')).toBe('travel')
  })

  it('prefixes me/ when browsing personal me/ root', () => {
    expect(mergeWikiBrowseChildPath({ type: 'wiki-dir', path: 'me' }, 'trips')).toBe('me/trips')
  })

  it('does not prepend on local me/… paths already unified', () => {
    expect(mergeWikiBrowseChildPath(sharedDirOverlay, MY_WIKI_URL_SEGMENT)).toBe(MY_WIKI_URL_SEGMENT)
    expect(mergeWikiBrowseChildPath(sharedDirOverlay, `${MY_WIKI_URL_SEGMENT}/trips`)).toBe(
      `${MY_WIKI_URL_SEGMENT}/trips`,
    )
  })
})

describe('parseUnifiedWikiBrowsePath', () => {
  it('strips me/ prefix', () => {
    expect(parseUnifiedWikiBrowsePath('me/ideas/x.md')).toEqual({ vaultRelPath: 'ideas/x.md' })
  })

  it('parses @peer paths', () => {
    expect(parseUnifiedWikiBrowsePath('@alice/trips/a.md')).toEqual({
      shareHandle: 'alice',
      vaultRelPath: 'trips/a.md',
    })
  })
})

describe('wikiBrowseFolderDirIconKey', () => {
  it('returns vault-relative tail for personal and shared browse folders', () => {
    expect(wikiBrowseFolderDirIconKey('me')).toBeUndefined()
    expect(wikiBrowseFolderDirIconKey('me/people')).toBe('people')
    expect(wikiBrowseFolderDirIconKey('@alice')).toBeUndefined()
    expect(wikiBrowseFolderDirIconKey('@alice/trips')).toBe('trips')
  })
})

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

  it('file share matches when list path and stored pathPrefix both use me/… (header badge)', () => {
    expect(wikiShareCoversVaultPath('ideas/note.md', 'me/ideas/note.md', 'file')).toBe(true)
    expect(countOutgoingSharesForVaultPath('me/ideas/note.md', [{ pathPrefix: 'me/ideas/note.md', targetKind: 'file' }])).toBe(
      1,
    )
  })

  it('directory share matches when stored pathPrefix uses me/…', () => {
    const owned = [{ pathPrefix: 'me/topics/', targetKind: 'dir' as const }]
    expect(countOutgoingSharesForVaultPath('me/topics/a.md', owned)).toBe(1)
  })

  it('vaultPathHasOutgoingShare aggregates owned shares', () => {
    expect(
      vaultPathHasOutgoingShare('topics/a.md', [{ pathPrefix: 'topics/', targetKind: 'dir' }]),
    ).toBe(true)
    expect(vaultPathHasOutgoingShare('ideas/x.md', [{ pathPrefix: 'topics/', targetKind: 'dir' }])).toBe(
      false,
    )
  })

  it('countOutgoingSharesForVaultPath counts each matching grant row', () => {
    const owned = [
      { pathPrefix: 'topics/', targetKind: 'dir' as const },
      { pathPrefix: 'topics/', targetKind: 'dir' as const },
      { pathPrefix: 'ideas/note.md', targetKind: 'file' as const },
    ]
    expect(countOutgoingSharesForVaultPath('topics/a.md', owned)).toBe(2)
    expect(countOutgoingSharesForVaultPath('ideas/note.md', owned)).toBe(1)
    expect(countOutgoingSharesForVaultPath('ideas/x.md', owned)).toBe(0)
    expect(countOutgoingSharesForVaultPath('me/topics/a.md', owned)).toBe(2)
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
    expect(r.filter((e) => e.kind === 'file').map((e) => e.path)).toEqual(['me/me.md'])
  })

  it('lists files and subdirs inside a folder', () => {
    const r = listWikiDirChildren(files, 'people')
    expect(r.find((e) => e.kind === 'file' && e.path === 'me/people/adam.md')).toBeTruthy()
    expect(r.find((e) => e.kind === 'dir' && e.path === 'me/people/team')).toBeTruthy()
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
    expect(r.find((e) => e.path === 'me/ideas')).toBeTruthy()
    expect(r.find((e) => e.kind === 'shared-owner')).toBeUndefined()
  })

  it('my-wiki URL segment lists same as My Wiki virtual folder', () => {
    const a = listWikiDirChildrenWithShares(files, MY_WIKI_URL_SEGMENT, received)
    const b = listWikiDirChildrenWithShares(files, MY_WIKI_SEGMENT, received)
    expect(a).toEqual(b)
  })

  it('with no shares, my-wiki virtual path lists vault root', () => {
    const r = listWikiDirChildrenWithShares(files, MY_WIKI_URL_SEGMENT, [])
    expect(r.find((e) => e.path === 'me/ideas')).toBeTruthy()
    expect(r.find((e) => e.path === 'me/people')).toBeTruthy()
  })
})
