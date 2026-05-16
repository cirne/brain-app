import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listTenants: vi.fn(),
  readOnboarding: vi.fn(),
  mailStatus: vi.fn(),
  readBg: vi.fn(),
  syncInbox: vi.fn(),
  getDefer: vi.fn(),
}))

vi.mock('@server/agent/yourWikiSupervisor.js', () => ({
  YOUR_WIKI_DOC_ID: 'your-wiki',
  getWikiSupervisorMailSyncDeferSnapshot: h.getDefer,
}))

vi.mock('@server/lib/tenant/listTenantUserIdsUnderDataRoot.js', () => ({
  listTenantUserIdsUnderDataRoot: h.listTenants,
}))

vi.mock('@server/lib/onboarding/onboardingState.js', () => ({
  readOnboardingStateDoc: h.readOnboarding,
}))

vi.mock('@server/lib/onboarding/onboardingMailStatus.js', () => ({
  getOnboardingMailStatus: h.mailStatus,
}))

vi.mock('@server/lib/chat/backgroundAgentStore.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@server/lib/chat/backgroundAgentStore.js')>()
  return { ...mod, readBackgroundRun: h.readBg }
})

vi.mock('@server/lib/platform/syncAll.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@server/lib/platform/syncAll.js')>()
  return { ...mod, syncInboxRipmail: h.syncInbox }
})

import {
  __resetScheduledRipmailSyncCoordinatorForTests,
  __runScheduledRipmailSweepOnceForTests,
} from './scheduledRipmailSync.js'

const tid = 'usr_' + 'c'.repeat(20)

describe('scheduledRipmailSync sweep', () => {
  beforeEach(() => {
    __resetScheduledRipmailSyncCoordinatorForTests()
    vi.clearAllMocks()
    h.getDefer.mockReturnValue({
      loopRunning: false,
      isPaused: false,
      shutdownRequested: false,
      loopTenantUserId: null,
    })
    h.listTenants.mockResolvedValue([tid])
    h.readOnboarding.mockResolvedValue({ state: 'done' })
    h.mailStatus.mockResolvedValue({ configured: true, staleMailSyncLock: false })
    h.readBg.mockResolvedValue(null)
    h.syncInbox.mockResolvedValue({ ok: true })
  })

  it('skips sync when onboarding is still indexing', async () => {
    h.readOnboarding.mockResolvedValue({ state: 'indexing' })
    await __runScheduledRipmailSweepOnceForTests()
    expect(h.syncInbox).not.toHaveBeenCalled()
  })

  it('calls syncInboxRipmail when mail is configured and onboarding done', async () => {
    await __runScheduledRipmailSweepOnceForTests()
    expect(h.syncInbox).toHaveBeenCalledTimes(1)
  })

  it('skips when staleMailSyncLock', async () => {
    h.mailStatus.mockResolvedValue({
      configured: true,
      staleMailSyncLock: true,
    })
    await __runScheduledRipmailSweepOnceForTests()
    expect(h.syncInbox).not.toHaveBeenCalled()
  })

  it('skips when historical backfill is running', async () => {
    h.mailStatus.mockResolvedValue({
      configured: true,
      staleMailSyncLock: false,
      backfillRunning: true,
    })
    await __runScheduledRipmailSweepOnceForTests()
    expect(h.syncInbox).not.toHaveBeenCalled()
  })

  it('calls syncInboxRipmail when backfill is not running', async () => {
    h.mailStatus.mockResolvedValue({
      configured: true,
      staleMailSyncLock: false,
      backfillRunning: false,
    })
    await __runScheduledRipmailSweepOnceForTests()
    expect(h.syncInbox).toHaveBeenCalledTimes(1)
  })

  it('defers when wiki supervisor is mid-lap for this tenant', async () => {
    h.getDefer.mockReturnValue({
      loopRunning: true,
      isPaused: false,
      shutdownRequested: false,
      loopTenantUserId: tid,
    })
    h.readBg.mockResolvedValue({ phase: 'enriching', lap: 3 })
    await __runScheduledRipmailSweepOnceForTests()
    expect(h.syncInbox).not.toHaveBeenCalled()
  })

  it('runs tenant sweeps concurrently so one tenant does not block the rest', async () => {
    const tenants = [
      'usr_' + 'a'.repeat(20),
      'usr_' + 'b'.repeat(20),
      'usr_' + 'd'.repeat(20),
    ]
    h.listTenants.mockResolvedValue(tenants)

    let active = 0
    let maxActive = 0
    const resolvers: Array<() => void> = []
    h.syncInbox.mockImplementation(
      () =>
        new Promise((resolve) => {
          active += 1
          maxActive = Math.max(maxActive, active)
          resolvers.push(() => {
            active -= 1
            resolve({ ok: true })
          })
        }),
    )

    const sweep = __runScheduledRipmailSweepOnceForTests()
    await vi.waitFor(() => expect(h.syncInbox).toHaveBeenCalledTimes(tenants.length))

    expect(maxActive).toBeGreaterThan(1)
    for (const resolve of resolvers) resolve()
    await sweep
  })
})
