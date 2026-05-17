/** Client shapes for ripmail hub sources (/api/hub/sources, detail, mail-status). */

/** Svelte `$t` / plain i18next `t` — keys use `hub.*` namespace prefix. */
export type HubRelativeTimeTranslator = (key: string, vars?: Record<string, unknown>) => string

function hubEmpty(t: HubRelativeTimeTranslator): string {
  return t('hub.ripmailSource.empty')
}

function formatRelativeBuckets(
  d: Date,
  t: HubRelativeTimeTranslator,
  formatOlder: (d: Date) => string,
): string {
  const now = Date.now()
  const diffMs = now - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const base = 'hub.mailRelativeTime.'

  if (diffSec < 60) return t(`${base}justNow`)
  if (diffMin < 60) return t(`${base}minutesAgo`, { count: diffMin })
  if (diffHour < 24) return t(`${base}hoursAgo`, { count: diffHour })
  if (diffDay === 1) return t(`${base}yesterday`)
  if (diffDay < 7) return t(`${base}daysAgo`, { count: diffDay })
  return formatOlder(d)
}

export type HubRipmailSourceRow = {
  id: string
  kind: string
  displayName: string
  path: string | null
  /** OAuth cluster id from ripmail config (Google account grouping). */
  oauthSourceId?: string
  email?: string
}

export type HubMailStatusMailbox = {
  messageCount: number
  earliestDate: string | null
  latestDate: string | null
  newestIndexedAgo: string | null
  needsBackfill: boolean
  lastUid: number | null
}

export type HubMailStatusIndex = {
  totalIndexed: number | null
  syncRunning: boolean
  staleLockInDb: boolean
  refreshRunning: boolean
  backfillRunning: boolean
  backfillListedTarget: number | null
  lastSyncAt: string | null
  lastSyncAgoHuman: string | null
}

export type HubMailStatusOk = {
  ok: true
  sourceId: string
  mailbox: HubMailStatusMailbox | null
  index: HubMailStatusIndex
}

export type HubSourceDetailFileSource = {
  roots: { id: string; name: string; recursive: boolean }[]
  includeGlobs: string[]
  ignoreGlobs: string[]
  maxFileBytes: number
  respectGitignore: boolean
}

export type HubSourceDetailOk = {
  ok: true
  id: string
  kind: string
  displayName: string
  path: string | null
  email: string | null
  label: string | null
  oauthSourceId: string | null
  fileSource: HubSourceDetailFileSource | null
  includeSharedWithMe: boolean
  calendarIds: string[] | null
  icsUrl: string | null
  status: {
    documentIndexRows: number
    calendarEventRows: number
    lastSyncedAt: string | null
  } | null
  statusError?: string
}

export function formatDay(iso: string | null, t: HubRelativeTimeTranslator): string {
  if (!iso?.trim()) return hubEmpty(t)
  const x = iso.trim()
  return x.length >= 10 ? x.slice(0, 10) : x
}

/**
 * Convert an ISO timestamp (or YYYY-MM-DD date string) to a human-friendly relative string.
 * e.g. localized "just now", "3m ago", "yesterday", "Apr 28"
 */
export function formatRelativeDate(iso: string | null, t: HubRelativeTimeTranslator): string {
  if (!iso?.trim()) return hubEmpty(t)
  const s = iso.trim()
  // Normalize SQLite datetime('now') output "YYYY-MM-DD HH:MM:SS" → ISO 8601
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return s.length >= 10 ? s.slice(0, 10) : hubEmpty(t)
  return formatRelativeBuckets(d, t, (dd) =>
    dd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  )
}

/**
 * Relative “last sync” buckets for hub mail index copy, localized via {@link HubRelativeTimeTranslator}.
 * Parses SQLite `"YYYY-MM-DD HH:MM:SS"` the same way as {@link formatRelativeDate}.
 */
export function formatRelativeMailSyncedAt(
  iso: string | null | undefined,
  t: HubRelativeTimeTranslator,
): string {
  if (!iso?.trim()) return hubEmpty(t)
  const s = iso.trim()
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return s.length >= 10 ? s.slice(0, 10) : hubEmpty(t)

  return formatRelativeBuckets(d, t, (dd) => dd.toLocaleDateString())
}

export function isMailSourceKind(kind: string): boolean {
  return kind === 'imap' || kind === 'applemail'
}

export function formatLastSync(idx: HubMailStatusIndex, t: HubRelativeTimeTranslator): string {
  if (idx.lastSyncAt?.trim()) return formatRelativeMailSyncedAt(idx.lastSyncAt, t)
  if (idx.lastSyncAgoHuman?.trim()) return idx.lastSyncAgoHuman.trim()
  return hubEmpty(t)
}

export function sourceKindLabel(kind: string, t: HubRelativeTimeTranslator): string {
  switch (kind) {
    case 'imap':
      return t('hub.ripmailSource.sourceKind.imap')
    case 'applemail':
      return t('hub.ripmailSource.sourceKind.applemail')
    case 'localDir':
      return t('hub.ripmailSource.sourceKind.localDir')
    case 'googleCalendar':
      return t('hub.ripmailSource.sourceKind.googleCalendar')
    case 'appleCalendar':
      return t('hub.ripmailSource.sourceKind.appleCalendar')
    case 'icsSubscription':
      return t('hub.ripmailSource.sourceKind.icsSubscription')
    case 'icsFile':
      return t('hub.ripmailSource.sourceKind.icsFile')
    case 'googleDrive':
      return t('hub.ripmailSource.sourceKind.googleDrive')
    default:
      return kind
  }
}

export const HUB_MAIL_BACKFILL_WINDOW_OPTIONS = [
  { value: '30d', labelKey: 'hub.ripmailSource.backfillWindow.30d' as const },
  { value: '90d', labelKey: 'hub.ripmailSource.backfillWindow.90d' as const },
  { value: '180d', labelKey: 'hub.ripmailSource.backfillWindow.180d' as const },
  { value: '1y', labelKey: 'hub.ripmailSource.backfillWindow.1y' as const },
  { value: '2y', labelKey: 'hub.ripmailSource.backfillWindow.2y' as const },
] as const

export type HubMailBackfillWindow = (typeof HUB_MAIL_BACKFILL_WINDOW_OPTIONS)[number]['value']

/** Default historical span for “download older mail” when the user no longer picks a range in the UI. */
export const HUB_MAIL_BACKFILL_DEFAULT_SINCE: HubMailBackfillWindow = '1y'

/** Match `historicalSinceToAfterEpochSeconds` in `@server/ripmail/sync/gmail.ts` (day counts × 86400 s). */
const DAY_MS = 86_400_000 as const

export const HUB_MAIL_BACKFILL_WINDOW_MS: Record<HubMailBackfillWindow, number> = {
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
  '180d': 180 * DAY_MS,
  '1y': 365 * DAY_MS,
  '2y': 2 * 365 * DAY_MS,
}

/** Parse mailbox min date from ripmail/API (ISO, date-only, or SQLite datetime). Returns UTC ms or null. */
export function mailboxEarliestDateUtcMs(earliestDate: string | null | undefined): number | null {
  if (!earliestDate?.trim()) return null
  const s = earliestDate.trim()
  let normalized = s
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) normalized = s.replace(' ', 'T') + 'Z'
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) normalized = `${s}T00:00:00Z`
  const d = new Date(normalized)
  return Number.isFinite(d.getTime()) ? d.getTime() : null
}

/**
 * True when the indexed mailbox spans at least the rolling window (oldest mail is on or before cutoff).
 * Uses the same spans as Gmail backfill `/sources/backfill` `since`.
 */
export function mailboxCoversHubBackfillWindow(
  earliestDate: string | null,
  messageCount: number,
  windowKey: string,
  nowMs: number = Date.now(),
): boolean {
  if (messageCount <= 0) return false
  const spanMs = HUB_MAIL_BACKFILL_WINDOW_MS[windowKey as HubMailBackfillWindow]
  if (spanMs === undefined || spanMs <= 0) return false
  const earliestMs = mailboxEarliestDateUtcMs(earliestDate)
  if (earliestMs === null) return false
  return earliestMs <= nowMs - spanMs
}
