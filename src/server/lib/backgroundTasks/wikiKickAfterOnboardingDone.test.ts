import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as onboardingMailStatus from '@server/lib/onboarding/onboardingMailStatus.js'
import type { OnboardingMailStatusPayload } from '@server/lib/onboarding/onboardingMailStatus.js'

const { mockEnsure } = vi.hoisted(() => ({
  mockEnsure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@server/agent/yourWikiSupervisor.js', (): { ensureYourWikiRunning: () => Promise<void> } => ({
  ensureYourWikiRunning: mockEnsure,
}))

const MS_PER_DAY = 86_400_000

/** Oldest indexed date far enough for `wikiSupervisorMailPreflightPasses` (90d rule). */
const DEEP_MAIL_FROM = '2015-01-01T00:00:00.000Z'

function mail(overrides: Partial<OnboardingMailStatusPayload> = {}): OnboardingMailStatusPayload {
  const base: OnboardingMailStatusPayload = {
    configured: true,
    indexedTotal: 1000,
    lastSyncedAt: null,
    dateRange: { from: DEEP_MAIL_FROM, to: '2026-01-15T12:00:00.000Z' },
    syncRunning: false,
    refreshRunning: false,
    backfillRunning: false,
    syncLockAgeMs: null,
    ftsReady: 1000,
    messageAvailableForProgress: 1000,
    pendingBackfill: false,
    deepHistoricalPending: false,
    staleMailSyncLock: false,
    indexingHint: null,
  }
  return {
    ...base,
    ...overrides,
    deepHistoricalPending: overrides.deepHistoricalPending ?? base.deepHistoricalPending,
  }
}

describe('kickWikiSupervisorIfIndexedGatePasses', () => {
  beforeEach(async () => {
    mockEnsure.mockClear()
    const mod = await import('./wikiKickAfterOnboardingDone.js')
    mod._resetWikiKickHistoryThrottleForTests()
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

  it('does nothing when indexed history is too shallow even if count passes', async () => {
    const recent = new Date(Date.now() - 10 * MS_PER_DAY).toISOString()
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(
      mail({
        indexedTotal: 5000,
        ftsReady: 5000,
        dateRange: { from: recent, to: new Date().toISOString() },
      }),
    )
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('throttles repeated kicks while history stays shallow', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z').getTime())
    try {
      const recent = new Date(Date.now() - 10 * MS_PER_DAY).toISOString()
      const spy = vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(
        mail({
          indexedTotal: 5000,
          ftsReady: 5000,
          dateRange: { from: recent, to: new Date().toISOString() },
        }),
      )
      const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
      await kickWikiSupervisorIfIndexedGatePasses()
      await kickWikiSupervisorIfIndexedGatePasses()
      expect(spy).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(3 * 60_000 + 1)
      await kickWikiSupervisorIfIndexedGatePasses()
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('calls ensureYourWikiRunning when configured and indexed at threshold', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(mail())
    const { kickWikiSupervisorIfIndexedGatePasses } = await import('./wikiKickAfterOnboardingDone.js')
    await kickWikiSupervisorIfIndexedGatePasses()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
  })
})
