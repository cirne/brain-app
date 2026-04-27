/**
 * Local civil calendar YYYY-MM-DD for UI bucketing (BUG-021).
 * Timed events arrive as UTC `Z` ISO strings — never use `iso.slice(0, 10)` (UTC date).
 */

/** YYYY-MM-DD for the given instant in an explicit IANA timezone (deterministic in tests). */
export function civilYmdInTimeZone(iso: string, timeZone: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** YYYY-MM-DD in the environment local timezone (browser / Node test zone). */
export function localYmdFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Civil local calendar date for a timed event ISO string (use for day columns). */
export function localYmdFromIsoInstant(iso: string): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return civilYmdInTimeZone(iso, tz)
}
