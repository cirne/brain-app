/** Format indexed-mail coverage for Activity / Settings (human Month Year, not raw ISO). */

export type MailCoverageLabels = {
  present: string
  since: (date: string) => string
  range: (start: string, end: string) => string
  /** Earliest indexed date unknown; only latest (past) is available — rare in ripmail status. */
  newestAround: (date: string) => string
}

function parseLocalDay(iso: string | null): Date | null {
  if (!iso?.trim()) return null
  const s = iso.trim()
  const ymd = s.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split('-').map(Number)
    const dt = new Date(y, m - 1, d)
    return Number.isNaN(dt.getTime()) ? null : dt
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s
  const t = Date.parse(normalized)
  if (!Number.isFinite(t)) return null
  const dt = new Date(t)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function isCoverageEndPresent(to: Date, today: Date): boolean {
  return startOfLocalDay(to) >= startOfLocalDay(today)
}

function formatMonthYear(d: Date, locale: string | undefined): string {
  return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' })
}

function sameMonthYear(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

/**
 * @param today — inject for tests (defaults to `new Date()`).
 */
export function formatMailIndexCoverage(
  fromIso: string | null,
  toIso: string | null,
  labels: MailCoverageLabels,
  options?: { locale?: string; today?: Date },
): string | null {
  const locale = options?.locale
  const today = options?.today ?? new Date()
  const from = parseLocalDay(fromIso)
  const to = parseLocalDay(toIso)

  if (!from && !to) return null

  if (from && !to) {
    return labels.since(formatMonthYear(from, locale))
  }

  if (!from && to) {
    if (isCoverageEndPresent(to, today)) return null
    return labels.newestAround(formatMonthYear(to, locale))
  }

  const startLabel = formatMonthYear(from!, locale)
  if (sameMonthYear(from!, to!)) {
    return startLabel
  }

  const endLabel = isCoverageEndPresent(to!, today) ? labels.present : formatMonthYear(to!, locale)
  return labels.range(startLabel, endLabel)
}
