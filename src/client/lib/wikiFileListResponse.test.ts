import { describe, it, expect } from 'vitest'
import { parseWikiFileListJson, parseWikiListApiBody } from './wikiFileListResponse.js'

/**
 * Regression: Wiki.svelte used `files = await res.json()` and then `files.find(...)`.
 * Error bodies (e.g. `{ message: "Not Found" }`) or other non-arrays made `.find` throw.
 */
describe('parseWikiFileListJson', () => {
  it('returns the same data for a valid file list', () => {
    const rows = [
      { path: 'index.md', name: 'index' },
      { path: 'ideas/foo.md', name: 'foo' },
    ]
    expect(parseWikiFileListJson(rows)).toEqual(rows)
  })

  it('returns [] when the body is a typical error object (not an array)', () => {
    expect(parseWikiFileListJson({ error: 'bad' })).toEqual([])
    expect(parseWikiFileListJson({ message: 'Not Found' })).toEqual([])
    expect(parseWikiFileListJson({ ok: false })).toEqual([])
  })

  it('returns [] for null, primitives, and non-arrays', () => {
    expect(parseWikiFileListJson(null)).toEqual([])
    expect(parseWikiFileListJson(undefined)).toEqual([])
    expect(parseWikiFileListJson('[]')).toEqual([])
    expect(parseWikiFileListJson({})).toEqual([])
  })

  it('skips list entries missing path or name', () => {
    expect(
      parseWikiFileListJson([
        { path: 'a.md', name: 'a' },
        { path: 'b.md' },
        { name: 'only' },
        null,
        'x',
      ]),
    ).toEqual([{ path: 'a.md', name: 'a' }])
  })
})

describe('parseWikiListApiBody', () => {
  it('parses envelope with files (ignores legacy shares payload)', () => {
    const body = {
      files: [{ path: 'x.md', name: 'x' }],
      shares: {
        owned: [{ pathPrefix: 'ideas/', targetKind: 'dir' as const }],
        received: [],
      },
    }
    const r = parseWikiListApiBody(body)
    expect(r.files).toEqual([{ path: 'x.md', name: 'x' }])
  })

  it('accepts legacy plain array as files-only', () => {
    const rows = [{ path: 'a.md', name: 'a' }]
    expect(parseWikiListApiBody(rows).files).toEqual(rows)
  })
})
