import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
import type { OnboardingMailStatus } from '../onboarding/onboardingTypes.js'

/** Map unified `/api/background-status` mail slice → legacy Hub mail shape. */
export function onboardingMailStatusFromBackground(
  m: BackgroundStatusResponse['mail'],
): OnboardingMailStatus {
  return {
    configured: m.configured,
    indexedTotal: m.indexedTotal,
    lastSyncedAt: m.lastSyncedAt,
    dateRange: m.dateRange,
    syncRunning: m.syncRunning,
    refreshRunning: m.refreshRunning,
    backfillRunning: m.backfillRunning,
    syncLockAgeMs: m.syncLockAgeMs,
    ftsReady: m.ftsReady ?? m.indexedTotal,
    messageAvailableForProgress: m.messageAvailableForProgress ?? m.indexedTotal,
    backfillListedTarget: m.backfillListedTarget ?? null,
    pendingBackfill: m.pendingBackfill,
    deepHistoricalPending: m.deepHistoricalPending ?? false,
    staleMailSyncLock: m.staleMailSyncLock,
    indexingHint: m.indexingHint,
    statusError: m.statusError,
  }
}
