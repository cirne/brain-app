import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ripmailRefreshMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, messagesAdded: 0, messagesUpdated: 0 }))

vi.mock('@server/ripmail/sync/index.js', () => ({
  refresh: ripmailRefreshMock,
}))

vi.mock('@server/lib/platform/googleOAuth.js', () => ({
  ensureGoogleOAuthImapSiblingSources: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@server/lib/notifications/syncMailNotifyNotifications.js', () => ({
  syncMailNotifyNotificationsFromRipmailDbSafe: vi.fn().mockResolvedValue(undefined),
}))

import { refreshMailAndWait, syncInboxRipmailBounded } from './syncAll.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'refresh-mail-wait-'))
  process.env.BRAIN_HOME = brainHome
  ripmailRefreshMock.mockReset()
  ripmailRefreshMock.mockResolvedValue({ ok: true, messagesAdded: 0, messagesUpdated: 0 })
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('refreshMailAndWait', () => {
  it('returns ok:false when refresh rejects', async () => {
    ripmailRefreshMock.mockRejectedValueOnce(new Error('sync timed out'))
    const r = await refreshMailAndWait(90_000)
    // TS refresh doesn't distinguish timeout from error — both return ok:false
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('returns ok:true when refresh completes', async () => {
    const r = await refreshMailAndWait(5000)
    expect(r.ok).toBe(true)
    expect(r.timedOut).toBeUndefined()
  })

  it('returns timedOut while leaving a slow refresh running', async () => {
    vi.useFakeTimers()
    let resolveRefresh!: () => void
    let refreshCompleted = false
    ripmailRefreshMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () => {
            refreshCompleted = true
            resolve({ ok: true, messagesAdded: 0, messagesUpdated: 0 })
          }
        }),
    )

    const resultPromise = refreshMailAndWait(10)
    await vi.advanceTimersByTimeAsync(10)

    await expect(resultPromise).resolves.toMatchObject({ ok: false, timedOut: true })
    expect(refreshCompleted).toBe(false)

    resolveRefresh()
    await Promise.resolve()
    await Promise.resolve()
    expect(refreshCompleted).toBe(true)
  })

  it('returns an error when the wait is aborted', async () => {
    let resolveRefresh!: () => void
    ripmailRefreshMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () => resolve({ ok: true, messagesAdded: 0, messagesUpdated: 0 })
        }),
    )

    const abort = new AbortController()
    const resultPromise = refreshMailAndWait(90_000, abort.signal)
    abort.abort()

    await expect(resultPromise).resolves.toMatchObject({ ok: false, error: 'aborted' })
    resolveRefresh()
    await Promise.resolve()
    await Promise.resolve()
  })
})

describe('syncInboxRipmailBounded', () => {
  it('returns completed when refresh finishes within the wait budget', async () => {
    const r = await syncInboxRipmailBounded({ timeoutMs: 5000, sourceId: 'src1' })

    expect(r).toEqual({ kind: 'completed', ok: true })
    expect(ripmailRefreshMock).toHaveBeenCalledWith(expect.any(String), { sourceId: 'src1' })
  })

  it('returns completed with an error when refresh rejects before timeout', async () => {
    ripmailRefreshMock.mockRejectedValueOnce(new Error('boom'))

    const r = await syncInboxRipmailBounded({ timeoutMs: 5000 })

    expect(r.kind).toBe('completed')
    if (r.kind !== 'completed') throw new Error(`expected completed, got ${r.kind}`)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('boom')
    }
  })
})
