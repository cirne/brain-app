/**
 * TypeScript types for the ripmail in-process module.
 *
 * JSON shapes mirror the Rust CLI output (ripmail/src/search/types.rs,
 * ripmail/src/refresh.rs, etc.) so callers that previously parsed JSON stdout
 * can switch to typed function calls with minimal changes.
 */
import type { VisualArtifact } from '@shared/visualArtifacts.js'

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Regex pattern matched against subject + body. Uses JS regex syntax. */
  query?: string
  pattern?: string
  caseSensitive?: boolean
  limit?: number
  offset?: number
  from?: string
  to?: string
  subject?: string
  afterDate?: string
  beforeDate?: string
  /**
   * When set, rolling `after` / `before` values (`180d`, `1y`, …) resolve relative to this instant
   * instead of wall clock (Enron demo tenants align searches with the corpus-era prompt clock).
   */
  rollingAnchorDate?: Date
  category?: string
  /** When true, from and to filters are combined with OR. */
  fromOrToUnion?: boolean
  /** When set, restrict to these source IDs. */
  sourceIds?: string[]
  includeAll?: boolean
  ownerAddress?: string
  ownerAliases?: string[]
}

export interface SearchResult {
  messageId: string
  threadId: string
  sourceId: string
  sourceKind: string
  fromAddress: string
  fromName?: string
  subject: string
  date: string
  snippet: string
  bodyPreview: string
  indexedRelPath?: string
  rank: number
}

export interface SearchTimings {
  patternMs?: number
  totalMs: number
}

export interface SearchResultSet {
  results: SearchResult[]
  timings: SearchTimings
  totalMatched?: number
  hints: string[]
  normalizedQuery?: string
}

// ---------------------------------------------------------------------------
// Read mail
// ---------------------------------------------------------------------------

export interface AttachmentMeta {
  id: number
  filename: string
  mimeType: string
  size: number
  extracted: boolean
  /** 1-based index for attachment read */
  index: number
  visualArtifact?: VisualArtifact
}

export interface ReadMailResult {
  messageId: string
  threadId: string
  sourceId: string
  fromAddress: string
  fromName?: string
  toAddresses: string[]
  ccAddresses: string[]
  subject: string
  date: string
  bodyText?: string
  bodyHtml?: string
  rawPath: string
  isArchived: boolean
  category?: string
  attachments?: AttachmentMeta[]
  visualArtifacts?: VisualArtifact[]
}

export interface ReadMailDisplayResult extends Omit<ReadMailResult, 'attachments' | 'bodyHtml' | 'bodyText'> {
  bodyKind: 'html' | 'text'
  bodyText: string
  bodyHtml?: string
}

// ---------------------------------------------------------------------------
// Read indexed file (Drive / localDir)
// ---------------------------------------------------------------------------

export interface ReadIndexedFileResult {
  id: string
  sourceKind: string
  title: string
  bodyText: string
  mime?: string
  size?: number
  visualArtifacts?: VisualArtifact[]
}

// ---------------------------------------------------------------------------
// Who / people
// ---------------------------------------------------------------------------

export interface PersonResult {
  personId: number
  displayName?: string
  primaryAddress: string
  addresses: string[]
  sentCount: number
  receivedCount: number
  lastContact?: string
}

export interface WhoResult {
  contacts: PersonResult[]
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface SourceStatus {
  sourceId: string
  kind: string
  label?: string
  lastSyncedAt?: string
  docCount: number
}

export interface StatusResult {
  indexedMessages: number
  sources: SourceStatus[]
  isRunning: boolean
  earliestSyncedDate?: string
  latestSyncedDate?: string
  lastSyncAt?: string
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export interface InboxItem {
  messageId: string
  sourceId: string
  fromAddress: string
  fromName?: string
  subject: string
  date: string
  snippet: string
  category?: string
  action: 'notify' | 'inform' | 'ignore'
  matchedRuleIds: string[]
  winningRuleId?: string
  decisionSource?: string
  note?: string
  requiresUserAction: boolean
  actionSummary?: string
  attachments?: AttachmentMeta[]
}

export interface InboxResult {
  items: InboxItem[]
  counts: { notify: number; inform: number; ignore: number; actionRequired: number }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface UserRule {
  kind: 'search'
  id: string
  action: 'notify' | 'inform' | 'ignore'
  query: string
  fromAddress?: string
  toAddress?: string
  subject?: string
  category?: string
  fromOrToUnion: boolean
  description?: string
  threadScope: boolean
}

/** Optional `rules.json` metadata (bundled defaults + per-tenant stamping). */
export interface RulesFileMetadata {
  /**
   * When **true** on the **bundled** default pack (`default_rules.v*.json`): existing tenants
   * whose `lastAppliedBundledRulesetRevision` is strictly less than `bundledRulesetRevision`
   * have on-disk `rules.json` replaced with the bundled rule set on the next `loadRulesFile` call.
   * When absent or false, bundled defaults apply only when `rules.json` is missing or unreadable.
   */
  overwriteExistingTenantsWithBundledDefault?: boolean
  /**
   * Monotonic revision for the bundled pack; bump alongside rule changes that should trigger
   * a reset when combined with `overwriteExistingTenantsWithBundledDefault`.
   */
  bundledRulesetRevision?: number
  /**
   * Revision last applied to this tenant file (persisted). Used with bundled revision to decide resets.
   */
  lastAppliedBundledRulesetRevision?: number
}

export interface RulesFile {
  version: number
  rules: UserRule[]
  context: unknown[]
  metadata?: RulesFileMetadata
}

export interface RulesListResult {
  version: number
  rules: UserRule[]
  metadata?: RulesFileMetadata
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type SourceKind = 'imap' | 'googleCalendar' | 'appleCalendar' | 'localDir' | 'googleDrive' | 'applemail'

export interface Source {
  id: string
  kind: SourceKind | string
  label?: string
  includeInDefault: boolean
  lastSyncedAt?: string
  docCount: number
}

export interface SourcesListResult {
  sources: Source[]
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  uid: string
  sourceId: string
  sourceKind: string
  calendarId: string
  calendarName?: string
  summary?: string | null
  description?: string | null
  location?: string | null
  startAt: number
  endAt: number
  allDay: boolean
  timezone?: string | null
  status?: string | null
  rrule?: string | null
  recurrenceJson?: string | null
  organizerEmail?: string | null
  organizerName?: string | null
  attendeesJson?: string | null
  color?: string | null
}

export interface CalendarRangeResult {
  events: CalendarEvent[]
  sourcesConfigured: boolean
}

export interface CalendarListItem {
  id: string
  name?: string
  sourceId: string
}

// ---------------------------------------------------------------------------
// Draft / send
// ---------------------------------------------------------------------------

export interface DraftRecipients {
  to?: string[]
  cc?: string[]
  bcc?: string[]
}

export interface Draft {
  id: string
  subject: string
  body: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  sourceId?: string
  inReplyToMessageId?: string
  forwardMessageId?: string
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export interface ArchiveResult {
  results: Array<{ messageId: string; local: { ok: boolean } }>
}

// ---------------------------------------------------------------------------
// Refresh (sync)
// ---------------------------------------------------------------------------

/** Hub onboarding/backfill vocabulary — Gmail TS sync only; IMAP ignores this today. */
export type RipmailHistoricalSince = '30d' | '90d' | '180d' | '1y' | '2y'

export interface RefreshOptions {
  sourceId?: string
  foreground?: boolean
  /** Gmail historical window for messages.list (paginated). Incremental history.list when unset. */
  historicalSince?: RipmailHistoricalSince
  /** Dev/CLI: Google Drive sync milestones (e.g. `scripts/dev-drive-sync-e2e.ts`). Hub leaves unset. */
  onDriveProgress?: (message: string) => void
  /**
   * Dev/CLI: delete local `document_index` / `cloud_file_meta` / `google_drive_sync_state` for this
   * Drive source, then run `files.list` bootstrap. Hub leaves unset.
   */
  forceDriveBootstrap?: boolean
}

export interface RefreshSourceResult {
  sourceId: string
  kind: string
  ok: boolean
  durationMs: number
  messagesAdded?: number
  messagesUpdated?: number
  eventsUpserted?: number
  eventsDeleted?: number
  error?: string
}

export interface RefreshResult {
  ok: boolean
  messagesAdded: number
  messagesUpdated: number
  sourceId?: string
  sources?: RefreshSourceResult[]
}
