import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

const dispatchMocks = vi.hoisted(() => ({
  syncInboxRipmail: vi.fn().mockResolvedValue({ ok: true }),
  syncInboxRipmailOnboarding: vi.fn().mockResolvedValue({ ok: true }),
  readOnboardingStateDoc: vi.fn(),
}))

vi.mock('@server/lib/platform/syncAll.js', () => ({
  syncInboxRipmail: dispatchMocks.syncInboxRipmail,
  syncInboxRipmailOnboarding: dispatchMocks.syncInboxRipmailOnboarding,
}))

vi.mock('@server/lib/onboarding/onboardingState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/onboarding/onboardingState.js')>()
  return { ...actual, readOnboardingStateDoc: dispatchMocks.readOnboardingStateDoc }
})

import inboxRoute from './inbox.js'

describe('POST /api/inbox/sync onboarding dispatch (OPP-093)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    dispatchMocks.syncInboxRipmail.mockResolvedValue({ ok: true })
    dispatchMocks.syncInboxRipmailOnboarding.mockResolvedValue({ ok: true })
    app = new Hono()
    app.route('/api/inbox', inboxRoute)
  })

  async function assertSyncDispatched() {
    await vi.waitFor(() => {
      expect(
        dispatchMocks.syncInboxRipmail.mock.calls.length +
          dispatchMocks.syncInboxRipmailOnboarding.mock.calls.length,
      ).toBeGreaterThan(0)
    })
  }

  it('uses syncInboxRipmailOnboarding for not-started (not refresh)', async () => {
    dispatchMocks.readOnboardingStateDoc.mockResolvedValue({
      state: 'not-started',
      updatedAt: new Date().toISOString(),
    })
    const res = await app.request('/api/inbox/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await assertSyncDispatched()
    expect(dispatchMocks.syncInboxRipmailOnboarding).toHaveBeenCalledTimes(1)
    expect(dispatchMocks.syncInboxRipmail).not.toHaveBeenCalled()
  })

  it('uses syncInboxRipmailOnboarding for indexing', async () => {
    dispatchMocks.readOnboardingStateDoc.mockResolvedValue({
      state: 'indexing',
      updatedAt: new Date().toISOString(),
    })
    const res = await app.request('/api/inbox/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    await assertSyncDispatched()
    expect(dispatchMocks.syncInboxRipmailOnboarding).toHaveBeenCalledTimes(1)
    expect(dispatchMocks.syncInboxRipmail).not.toHaveBeenCalled()
  })

  it('uses syncInboxRipmail (refresh) for done and onboarding-agent', async () => {
    for (const state of ['done', 'onboarding-agent'] as const) {
      dispatchMocks.readOnboardingStateDoc.mockResolvedValue({
        state,
        updatedAt: new Date().toISOString(),
      })
      const res = await app.request('/api/inbox/sync', { method: 'POST' })
      expect(res.status).toBe(200)
      await assertSyncDispatched()
      expect(dispatchMocks.syncInboxRipmail).toHaveBeenCalledTimes(1)
      expect(dispatchMocks.syncInboxRipmailOnboarding).not.toHaveBeenCalled()
      vi.clearAllMocks()
      dispatchMocks.syncInboxRipmail.mockResolvedValue({ ok: true })
      dispatchMocks.syncInboxRipmailOnboarding.mockResolvedValue({ ok: true })
    }
  })

  it('uses syncInboxRipmail for confirming-handle (not the 30d onboarding slice)', async () => {
    dispatchMocks.readOnboardingStateDoc.mockResolvedValue({
      state: 'confirming-handle',
      updatedAt: new Date().toISOString(),
    })
    const res = await app.request('/api/inbox/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    await assertSyncDispatched()
    expect(dispatchMocks.syncInboxRipmail).toHaveBeenCalledTimes(1)
    expect(dispatchMocks.syncInboxRipmailOnboarding).not.toHaveBeenCalled()
  })
})
