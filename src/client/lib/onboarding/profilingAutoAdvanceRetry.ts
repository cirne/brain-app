import { ONBOARDING_BACKFILL_STILL_RUNNING_CODE } from '@shared/onboardingProfileThresholds.js'

/**
 * After PATCH profiling returns 4xx, the onboarding auto-advance effect must not immediately retry
 * with unchanged mail stats — that hammers the server and freezes the UI. Retry only when indexed
 * count increased, after a backfill-busy rejection once `mail.backfillRunning` clears, or on manual retry.
 */
export function shouldRetryProfilingAutoAdvance(
  mailIndexedCount: number,
  lastFailedAtIndexedCount: number | null,
  lastFailedPatchCode: string | undefined,
  mailBackfillRunningNow: boolean,
): boolean {
  if (lastFailedAtIndexedCount === null) return true
  if (mailIndexedCount > lastFailedAtIndexedCount) return true
  return (
    lastFailedPatchCode === ONBOARDING_BACKFILL_STILL_RUNNING_CODE &&
    !mailBackfillRunningNow
  )
}
