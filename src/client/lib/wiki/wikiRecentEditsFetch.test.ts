import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchWikiRecentEditsList } from './wikiRecentEditsFetch.js'

describe('fetchWikiRecentEditsList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns empty list when both endpoints fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false } as Response)),
    )
    await expect(fetchWikiRecentEditsList(3)).resolves.toEqual([])
  })

  it('prefers edit-history when it returns files', async () => {
    const files = [{ path: 'a.md', date: '2026-01-01' }]
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('edit-history')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ files }),
          } as Response)
        }
        return Promise.resolve({ ok: false } as Response)
      }),
    )
    await expect(fetchWikiRecentEditsList(5)).resolves.toEqual(files)
  })
})
