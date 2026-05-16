import {
  WIKI_BUILDOUT_MIN_MESSAGES,
  WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS,
} from './onboardingProfileThresholds.js'

const MS_PER_DAY = 86_400_000

/** Parse ripmail / SQLite date strings (ISO or `YYYY-MM-DD HH:…`) to UTC ms. */
export function parseRipmailStatusDateToUtcMs(s: string | null | undefined): number | null {
  if (s == null || typeof s !== 'string') return null
  const t = s.trim()
  if (!t) return null
  const iso = t.includes('T') ? t : `${t.replace(' ', 'T')}Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/**
 * True when `dateRange.from` is a real message date on or before `(now - minWholeDays)` in wall time
 * (rolling window, `minWholeDays * 24h`).
 */
export function mailIndexOldestCoversMinDaysBeforeNow(
  dateRange: { from: string | null; to: string | null },
  minWholeDays: number,
  nowMs: number = Date.now(),
): boolean {
  const fromMs = parseRipmailStatusDateToUtcMs(dateRange.from)
  if (fromMs === null || fromMs > nowMs) return false
  if (minWholeDays <= 0) return true
  return fromMs <= nowMs - minWholeDays * MS_PER_DAY
}

export function mailIndexMeetsWikiSupervisorHistoryMinimum(
  dateRange: { from: string | null; to: string | null },
  nowMs: number = Date.now(),
): boolean {
  return mailIndexOldestCoversMinDaysBeforeNow(dateRange, WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS, nowMs)
}

/**
 * Indexed message-count gate + configured mailbox + minimum **depth** of indexed history (oldest message date).
 */
export function wikiSupervisorMailPreflightPasses(
  mail: {
    configured: boolean
    indexedTotal: number | null
    ftsReady: number | null
    dateRange: { from: string | null; to: string | null }
  },
  nowMs: number = Date.now(),
): boolean {
  if (!mail.configured) return false
  const indexed = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
  if (indexed < WIKI_BUILDOUT_MIN_MESSAGES) return false
  return mailIndexMeetsWikiSupervisorHistoryMinimum(mail.dateRange, nowMs)
}
