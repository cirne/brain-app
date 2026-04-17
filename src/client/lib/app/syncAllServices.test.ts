import { describe, it, expect, vi } from 'vitest'
import { aggregateSyncErrors, runParallelSyncs, type SyncResponseBody } from './syncAllServices.js'

describe('aggregateSyncErrors', () => {
  const ok: PromiseFulfilledResult<SyncResponseBody> = { status: 'fulfilled', value: { ok: true } }

  it('returns empty when all succeed', () => {
    expect(aggregateSyncErrors(ok, ok, ok)).toEqual([])
  })

  it('collects rejection reasons in Docs / Inbox / Calendar order', () => {
    const wikiRej: PromiseRejectedResult = { status: 'rejected', reason: 'net' }
    const inboxRej: PromiseRejectedResult = { status: 'rejected', reason: 'timeout' }
    expect(aggregateSyncErrors(wikiRej, ok, ok)).toEqual(['Docs: net'])
    expect(aggregateSyncErrors(ok, inboxRej, ok)).toEqual(['Inbox: timeout'])
    expect(aggregateSyncErrors(ok, ok, { status: 'rejected', reason: 'x' })).toEqual(['Calendar: x'])
  })

  it('uses json error or default when ok is false', () => {
    const wikiBad: PromiseFulfilledResult<SyncResponseBody> = {
      status: 'fulfilled',
      value: { ok: false, error: 'wiki unavailable' },
    }
    expect(aggregateSyncErrors(wikiBad, ok, ok)).toEqual(['Docs: wiki unavailable'])
    const noMsg: PromiseFulfilledResult<SyncResponseBody> = {
      status: 'fulfilled',
      value: { ok: false },
    }
    expect(aggregateSyncErrors(noMsg, ok, ok)).toEqual(['Docs: sync failed'])
  })

  it('does not error when fulfilled value is undefined', () => {
    const empty: PromiseFulfilledResult<SyncResponseBody> = { status: 'fulfilled', value: undefined as unknown as SyncResponseBody }
    expect(aggregateSyncErrors(empty, ok, ok)).toEqual([])
  })
})

describe('runParallelSyncs', () => {
  it('calls three sync endpoints and aggregates', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/wiki/sync')) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as Response)
      }
      if (url.includes('/inbox/sync')) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: false, error: 'bad' }) } as Response)
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) } as Response)
    })
    const errs = await runParallelSyncs(fetchMock as unknown as typeof fetch)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(errs).toEqual(['Inbox: bad'])
  })

  it('returns unexpected error when fetch throws synchronously', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('boom')
    })
    const out = await runParallelSyncs(fetchMock as unknown as typeof fetch)
    expect(out).toEqual(['Unexpected error: Error: boom'])
  })
})
