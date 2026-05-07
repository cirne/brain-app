import { ONBOARDING_PROFILE_INDEX_MANUAL_MIN } from './onboardingProfileThresholds.js'

/**
 * Subset of the `/api/onboarding/mail` payload used by the advance-to-interview gate.
 * Both server (`OnboardingMailStatusPayload`) and client (`OnboardingMailStatus`) satisfy this shape.
 */
export interface OnboardingMailGateInput {
  configured: boolean
  syncRunning: boolean
  refreshRunning?: boolean
  backfillRunning: boolean
  pendingBackfill?: boolean | null
  staleMailSyncLock?: boolean | null
  lastSyncedAt: string | null
  /** Optional actionable hint (stale lock, hang suspected). Blocks auto-advance when set. */
  indexingHint?: string | null
}

/**
 * True when the initial mail sync has finished and there is nothing pending — even if the
 * mailbox is small (e.g. a brand-new inbox with only a handful of messages). Lets the
 * onboarding state machine advance from `indexing → onboarding-agent` for users who would
 * never reach {@link ONBOARDING_PROFILE_INDEX_MANUAL_MIN} indexed messages.
 *
 * Required signals:
 *  - `configured`            — mailbox is set up
 *  - `lastSyncedAt`          — at least one sync has completed
 *  - `!syncRunning`          — no live sync subprocess
 *  - `!refreshRunning && !backfillRunning` — defensive (covers older payloads)
 *  - `!pendingBackfill`      — no mailbox row still reports `needsBackfill: true`
 *  - `!staleMailSyncLock`    — DB lock is healthy (not orphaned)
 *  - `!indexingHint`         — no actionable hang/stale hint blocking the user
 */
export function isOnboardingInitialMailSyncComplete(mail: OnboardingMailGateInput): boolean {
  if (!mail.configured) return false
  if (mail.staleMailSyncLock === true) return false
  if (mail.syncRunning) return false
  if (mail.refreshRunning === true) return false
  if (mail.backfillRunning) return false
  if (mail.pendingBackfill === true) return false
  if (mail.lastSyncedAt === null) return false
  if (mail.indexingHint != null && mail.indexingHint.trim() !== '') return false
  return true
}

/**
 * Combined gate for the `indexing → onboarding-agent` transition: either the indexed-count
 * threshold is met, or the initial sync is fully idle / drained (small-inbox auto-advance).
 */
export function canAdvanceToOnboardingAgent(
  indexedCount: number,
  mail: OnboardingMailGateInput,
): boolean {
  if (indexedCount >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN) return true
  return isOnboardingInitialMailSyncComplete(mail)
}
