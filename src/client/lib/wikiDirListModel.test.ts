import { describe, it, expect } from 'vitest'
import { listWikiDirChildren, normalizeWikiDirPath } from './wikiDirListModel.js'

const files = [
  { path: 'me.md', name: 'me' },
  { path: 'people/adam.md', name: 'adam' },
  { path: 'people/team/bob.md', name: 'bob' },
  { path: 'ideas/x.md', name: 'x' },
]

describe('normalizeWikiDirPath', () => {
  it('trims slashes', () => {
    expect(normalizeWikiDirPath('/people/')).toBe('people')
    expect(normalizeWikiDirPath(undefined)).toBe('')
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
