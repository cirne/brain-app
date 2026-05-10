/**
 * Index-time date normalization for rebuild-from-maildir (mirrors ripmail/src/sync/ingest_date.rs).
 */

/** Messages with index `date` strictly before this instant are untrustworthy for ingest/rebuild. */
export const TRUSTWORTHY_INDEX_EARLIEST = '1990-01-01T00:00:00+00:00'

export function parseStoredIndexDateUtc(s: string): Date | null {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function isUntrustworthyIndexDate(utc: Date): boolean {
  if (utc.getTime() === 0) return true
  const cutoff = parseStoredIndexDateUtc(TRUSTWORTHY_INDEX_EARLIEST)
  if (!cutoff) return false
  return utc < cutoff
}

export function isUntrustworthyIndexDateStr(s: string): boolean {
  const d = parseStoredIndexDateUtc(s)
  if (!d) return true
  return isUntrustworthyIndexDate(d)
}

/** Returns true if the row should be inserted; mutates `parsed.date` when normalizing to batch floor. */
export function applyRebuildIndexDateNormalization(
  parsed: { date: string },
  floor: string | undefined,
  rawPath: string,
): boolean {
  if (!isUntrustworthyIndexDateStr(parsed.date)) return true
  const was = parsed.date
  if (floor) {
    console.error(
      `ripmail(ts): warning: index date untrustworthy (${was}); normalized to batch min=${floor} path=${rawPath}`,
    )
    parsed.date = floor
    return true
  }
  console.error(
    `ripmail(ts): warning: index date untrustworthy (${was}); no trustworthy batch anchor; skipping path=${rawPath}`,
  )
  return false
}
