import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as onboardingMailStatus from '@server/lib/onboarding/onboardingMailStatus.js'
import type { OnboardingMailStatusPayload } from '@server/lib/onboarding/onboardingMailStatus.js'
import * as onboardingState from '@server/lib/onboarding/onboardingState.js'

const { mockEnsure } = vi.hoisted(() => ({
  mockEnsure: vi.fn().mockResolvedValue(undefined),
}))

const { mockEnqueue } = vi.hoisted(() => ({
  mockEnqueue: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@server/agent/yourWikiSupervisor.js', () => ({
  ensureYourWikiRunning: mockEnsure,
}))

vi.mock('@server/agent/wikiBootstrapRunner.js', () => ({
  enqueueWikiBootstrap: mockEnqueue,
}))

function mail(overrides: Partial<OnboardingMailStatusPayload> = {}): OnboardingMailStatusPayload {
  return {
    configured: true,
    indexedTotal: 1000,
    lastSyncedAt: null,
    dateRange: { from: null, to: null },
    syncRunning: false,
    refreshRunning: false,
    backfillRunning: false,
    syncLockAgeMs: null,
    ftsReady: 1000,
    messageAvailableForProgress: 1000,
    pendingBackfill: false,
    staleMailSyncLock: false,
    indexingHint: null,
    ...overrides,
  }
}

describe('kickWikiSupervisorIfIndexedGatePasses', () => {
  beforeEach(() => {
    mockEnsure.mockClear()
    mockEnqueue.mockClear()
    vi.spyOn(onboardingState, 'readWikiBootstrapState').mockResolvedValue({
      status: 'completed',
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      stats: { peopleCreated: 0, projectsCreated: 0, topicsCreated: 0, travelCreated: 0 },
    })
    delete process.env.WIKI_BOOTSTRAP_SKIP
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing when mail not configured', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(
      mail({ configured: false, indexedTotal: 5000, ftsReady: 5000 }),
    )
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('does nothing when indexed below WIKI_BUILDOUT_MIN_MESSAGES', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(
      mail({ indexedTotal: 999, ftsReady: 800 }),
    )
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('uses max(indexedTotal, ftsReady) against threshold', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(
      mail({ indexedTotal: 100, ftsReady: 1000 }),
    )
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
  })

  it('calls ensureYourWikiRunning when configured and indexed at threshold', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(mail())
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('runs enqueueWikiBootstrap when bootstrap has not started yet', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(mail())
    vi.spyOn(onboardingState, 'readWikiBootstrapState')
      .mockResolvedValueOnce({
        status: 'not-started',
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        status: 'completed',
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:00.000Z',
        stats: { peopleCreated: 1, projectsCreated: 0, topicsCreated: 0, travelCreated: 0 },
      })
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledTimes(1)
  })

  it('defers supervisor while bootstrap is running', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(mail())
    vi.spyOn(onboardingState, 'readWikiBootstrapState').mockResolvedValue({
      status: 'running',
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('starts supervisor when WIKI_BOOTSTRAP_SKIP without enqueue', async () => {
    process.env.WIKI_BOOTSTRAP_SKIP = 'true'
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(mail())
    vi.spyOn(onboardingState, 'readWikiBootstrapState').mockResolvedValue({
      status: 'not-started',
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const markSkipped = vi.spyOn(onboardingState, 'markWikiBootstrapSkipped').mockResolvedValue(undefined)
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(markSkipped).toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
  })
})
