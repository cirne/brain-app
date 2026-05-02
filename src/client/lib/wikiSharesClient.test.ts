import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWikiSharesList } from './wikiSharesClient.js'

describe('wikiSharesClient', () => {
  const origFetch = globalThis.fetch

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              owned: [],
              received: [{ id: 'a' }],
              pendingReceived: [{ id: 'b' }],
            }),
        } as Response),
      ),
    )
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    vi.unstubAllGlobals()
  })

  it('fetchWikiSharesList returns parsed JSON on success', async () => {
    const data = await fetchWikiSharesList()
    expect(data?.received).toHaveLength(1)
    expect(data?.pendingReceived).toHaveLength(1)
    expect(data?.owned).toHaveLength(0)
  })

  it('fetchWikiSharesList returns null when response not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false } as Response)),
    )
    expect(await fetchWikiSharesList()).toBeNull()
  })
})
