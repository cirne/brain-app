/**
 * Anchors the assistant’s “current date” for evals over historical mail (e.g. Enron 1999–2002).
 * When unset, callers use real wall time.
 *
 * Set **EVAL_ASSISTANT_NOW** to `YYYY-MM-DD` or full ISO8601. Enron v1 CLI defaults to
 * `2002-01-01` so relative / “recent” search and session context align with the corpus.
 */
export function resolveEvalAnchoredNow(): Date | null {
  const raw = process.env.EVAL_ASSISTANT_NOW?.trim()
  if (!raw) return null
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (ymd) {
    const y = Number(ymd[1])
    const mo = Number(ymd[2])
    const day = Number(ymd[3])
    if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || day < 1 || day > 31) return null
    return new Date(Date.UTC(y, mo - 1, day, 18, 0, 0))
  }
  const t = Date.parse(raw)
  if (!Number.isNaN(t)) return new Date(t)
  return null
}
