/** Client shapes for ripmail hub sources (/api/hub/sources, detail, mail-status). */

export type HubRipmailSourceRow = {
  id: string
  kind: string
  displayName: string
  path: string | null
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

export function formatDay(iso: string | null): string {
  if (!iso?.trim()) return '—'
  const t = iso.trim()
  return t.length >= 10 ? t.slice(0, 10) : t
}

export function isMailSourceKind(kind: string): boolean {
  return kind === 'imap' || kind === 'applemail'
}

export function formatLastSync(idx: HubMailStatusIndex): string {
  if (idx.lastSyncAgoHuman?.trim()) return idx.lastSyncAgoHuman.trim()
  return formatDay(idx.lastSyncAt)
}

export function sourceKindLabel(kind: string): string {
  switch (kind) {
    case 'imap':
      return 'Email (IMAP)'
    case 'applemail':
      return 'Apple Mail'
    case 'localDir':
      return 'Local folder'
    case 'googleCalendar':
      return 'Google Calendar'
    case 'appleCalendar':
      return 'Apple Calendar'
    case 'icsSubscription':
      return 'Subscribed calendar'
    case 'icsFile':
      return 'Calendar file'
    case 'googleDrive':
      return 'Google Drive'
    default:
      return kind
  }
}

export const HUB_MAIL_BACKFILL_WINDOW_OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '180d', label: '180 days' },
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
] as const
