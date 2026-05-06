/**
 * After PATCH onboarding state returns 4xx, the auto-advance effect must not immediately retry
 * with unchanged mail stats — that hammers the server. Retry only when indexed count increased,
 * or after manual retry clears {@link interviewAutoAdvanceLastFailedAtCount} / succeeds.
 */
export function shouldRetryProfilingAutoAdvance(
  mailIndexedCount: number,
  lastFailedAtIndexedCount: number | null,
): boolean {
  if (lastFailedAtIndexedCount === null) return true
  return mailIndexedCount > lastFailedAtIndexedCount
}
