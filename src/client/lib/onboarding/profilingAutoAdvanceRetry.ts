/**
 * After PATCH profiling returns 4xx, the onboarding auto-advance effect must not
 * immediately retry with the same mail stats — that hammers the server and freezes the UI.
 * Retry only when indexed count has increased (sync made progress) or the user triggers a manual continue.
 */
export function shouldRetryProfilingAutoAdvance(
  mailIndexedCount: number,
  lastFailedAtIndexedCount: number | null,
): boolean {
  return lastFailedAtIndexedCount === null || mailIndexedCount > lastFailedAtIndexedCount
}
