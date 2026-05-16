import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import {
  WIKI_BUILDOUT_MIN_MESSAGES,
  WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS,
} from '@shared/onboardingProfileThresholds.js'
import {
  mailIndexMeetsWikiSupervisorHistoryMinimum,
  wikiSupervisorMailPreflightPasses,
} from '@shared/wikiMailIndexedHistoryGate.js'

/** When message count passes but indexed history depth does not, skip kick retries until this (epoch ms). */
let nextWikiKickAfterShallowHistoryMs = 0

/** Min interval between `getOnboardingMailStatus` checks while waiting for deeper history (Hub poll throttle). */
const WIKI_KICK_HISTORY_COOLDOWN_MS = 3 * 60_000

/**
 * Start Your Wiki supervisor when indexed mail passes the wiki **preflight**: message count
 * (`WIKI_BUILDOUT_MIN_MESSAGES`) **and** at least `WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS` of history
 * (oldest indexed message date vs now).
 *
 * Triggered from GET `/api/onboarding/mail`, GET `/api/background-status`, and
 * `notifyOnboardingInterviewDone` (finalize) so the kick runs on poll or immediately after interview.
 *
 * While history depth is insufficient but message count is high enough, **throttles** repeat work to once per
 * {@link WIKI_KICK_HISTORY_COOLDOWN_MS} (in-process).
 */
export async function kickWikiSupervisorIfIndexedGatePasses(): Promise<void> {
  const now = Date.now()
  if (now < nextWikiKickAfterShallowHistoryMs) return

  const mail = await getOnboardingMailStatus()
  if (!mail.configured) return

  const indexed = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
  if (!wikiSupervisorMailPreflightPasses(mail)) {
    if (
      indexed >= WIKI_BUILDOUT_MIN_MESSAGES &&
      !mailIndexMeetsWikiSupervisorHistoryMinimum(mail.dateRange)
    ) {
      nextWikiKickAfterShallowHistoryMs = now + WIKI_KICK_HISTORY_COOLDOWN_MS
      console.log('[wiki/indexed-gate] waiting for deeper indexed mail history', {
        indexed,
        dateFrom: mail.dateRange?.from,
        minHistoryDays: WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS,
        nextKickAfterMs: nextWikiKickAfterShallowHistoryMs,
      })
    }
    return
  }

  nextWikiKickAfterShallowHistoryMs = 0
  console.log('[wiki/indexed-gate] Starting wiki supervisor', { indexed, dateFrom: mail.dateRange?.from })
  const { ensureYourWikiRunning } = await import('@server/agent/yourWikiSupervisor.js')
  void ensureYourWikiRunning().catch((e) =>
    console.error('[wiki/indexed-gate] wiki supervisor start failed:', e),
  )
}

/** @internal Test hook — reset kick throttle between cases. */
export function _resetWikiKickHistoryThrottleForTests(): void {
  nextWikiKickAfterShallowHistoryMs = 0
}
