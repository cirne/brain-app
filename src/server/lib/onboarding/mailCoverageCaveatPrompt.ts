import type { OnboardingMailStatusPayload } from '@server/lib/onboarding/onboardingMailStatus.js'
import { ONBOARDING_PROFILE_INDEX_MANUAL_MIN } from '@shared/onboardingProfileThresholds.js'

/**
 * When indexed mail is below “full coverage”, append this to the **main** assistant system prompt
 * (not onboarding interview) so the model does not overstate how much history is searchable.
 */
export function buildMailCoverageCaveatForMainAssistant(
  mail: OnboardingMailStatusPayload,
): string | null {
  if (!mail.configured) return null
  const indexed = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
  if (indexed >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN) return null

  const from = mail.dateRange?.from?.trim() || null
  const to = mail.dateRange?.to?.trim() || null
  const span =
    from && to
      ? `${from} through ${to}`
      : from
        ? `from ${from} (end not yet in the index snapshot)`
        : to
          ? `through ${to} (start not yet in the index snapshot)`
          : 'dates the index has not reported yet'

  const stillFetching =
    mail.syncRunning ||
    mail.refreshRunning ||
    mail.backfillRunning ||
    mail.pendingBackfill ||
    mail.deepHistoricalPending

  return [
    '## Mail index coverage (transient)',
    `Roughly **${indexed.toLocaleString()}** messages are in the local searchable index so far. The app treats on the order of **${ONBOARDING_PROFILE_INDEX_MANUAL_MIN.toLocaleString()}** indexed messages as “comfortable” depth for broad personal context—you are **below** that, so do **not** imply full mailbox history.`,
    `The index snapshot’s date span is **${span}** (from Ripmail status; approximate). Use mail tools accordingly: answer and help with wiki only as far as indexed mail actually supports.`,
    stillFetching
      ? 'Background sync or backfill may still be adding mail—coverage can improve in later chats.'
      : 'Older mail may still be missing from the index even when sync looks idle.',
    'If relevant, you may briefly mention this limitation so expectations stay realistic.',
  ].join('\n')
}
