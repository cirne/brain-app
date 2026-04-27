/**
 * Shared helpers for Enron / wiki JSONL eval CLIs.
 */

/**
 * @param cap typically task count; result is in [1, cap]
 */
export function parseEvalMaxConcurrency(envVal: string | undefined, defaultValue: number, cap: number): number {
  const d = Math.max(1, Math.min(cap, defaultValue))
  if (envVal === undefined || envVal.trim() === '') {
    return d
  }
  const n = parseInt(envVal, 10)
  if (Number.isNaN(n) || n < 1) {
    return d
  }
  return Math.max(1, Math.min(cap, n))
}
