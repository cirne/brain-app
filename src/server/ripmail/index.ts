/**
 * ripmail TypeScript module — public API.
 *
 * All operations take a `ripmailHome` path (the per-tenant ripmail directory,
 * e.g. `<BRAIN_DATA_ROOT>/<tenant>/ripmail`) and return typed objects.
 *
 * Older Brain code spawned the `ripmail` CLI for mail; `main` uses this module in-process.
 */

export {
  openRipmailDb,
  prepareRipmailDb,
  RipmailDbSchemaDriftError,
  closeRipmailDb,
  invalidateRipmailDbCache,
  openMemoryRipmailDb,
  ripmailDbPath,
} from './db.js'
export { SCHEMA_VERSION } from './schema.js'

export type {
  SearchOptions,
  SearchResult,
  SearchResultSet,
  SearchTimings,
  ReadMailResult,
  ReadMailDisplayResult,
  ReadIndexedFileResult,
  AttachmentMeta,
  PersonResult,
  WhoResult,
  StatusResult,
  SourceStatus,
  InboxItem,
  InboxResult,
  UserRule,
  RulesFile,
  RulesListResult,
  Source,
  SourcesListResult,
  CalendarEvent,
  CalendarRangeResult,
  CalendarListItem,
  Draft,
  ArchiveResult,
  RefreshOptions,
  RefreshResult,
} from './types.js'
export type { VisualArtifact } from '@shared/visualArtifacts.js'

import { prepareRipmailDb } from './db.js'
import { search } from './search.js'
import { readMail, readMailForDisplay, readIndexedFile } from './mailRead.js'
import { attachmentList, attachmentRead } from './attachments.js'
import { visualArtifactsFromAttachments } from './visualArtifacts.js'
import { who } from './who.js'
import { status, statusParsed } from './status.js'
import { inbox } from './inbox.js'
import { rulesList, rulesShow, rulesAdd, rulesEdit, rulesRemove, rulesMove, rulesValidate } from './rules.js'
import { sourcesList, sourcesStatus, sourcesAddLocalDir, sourcesAddGoogleDrive, sourcesEdit, sourcesRemove, ensureSourceRowsFromConfig } from './sources.js'
import { archive, unarchive } from './archive.js'
import { calendarRange, calendarListCalendars, calendarCreateEvent, calendarUpdateEvent } from './calendar.js'
import { draftNew, draftReply, draftForward, draftEdit, draftView, draftList, draftDelete } from './draft.js'
import { send } from './send.js'
import { refresh } from './sync/index.js'
import { listGoogleCalendarsForSource, cancelGoogleCalendarEventRemote, deleteGoogleCalendarEventRemote } from './sync/googleCalendar.js'
import { loadRipmailConfig } from './sync/config.js'
export { loadRipmailConfig, saveRipmailConfig, loadGoogleOAuthTokens, googleOAuthTokenSourceId } from './sync/config.js'
export { listGoogleDriveFolders } from './sync/googleDrive.js'
import type { InboxOptions } from './inbox.js'
import type { SearchOptions } from './types.js'

// Re-export option types
export type { InboxOptions } from './inbox.js'
export type {
  RulesListOptions, RulesShowOptions, RulesAddOptions, RulesEditOptions,
  RulesRemoveOptions, RulesMoveOptions, RulesValidateOptions, RulesValidateResult,
} from './rules.js'
export type {
  SourceStatusResult, AddLocalDirOptions, AddGoogleDriveOptions,
} from './sources.js'
export type { NewDraftOptions, ReplyDraftOptions, ForwardDraftOptions, EditDraftOptions } from './draft.js'
export type { SendOptions, SendResult } from './send.js'
export type {
  CreateEventOptions,
} from './calendar.js'

// ---------------------------------------------------------------------------
// Convenience wrappers — each accepts ripmailHome and opens/reuses the DB
// ---------------------------------------------------------------------------

/** Search mail and indexed files. */
export async function ripmailSearch(ripmailHome: string, opts: SearchOptions) {
  const db = await prepareRipmailDb(ripmailHome)
  return search(db, opts)
}

/** Read a mail message by Message-ID. */
export async function ripmailReadMail(
  ripmailHome: string,
  messageId: string,
  opts?: { plainBody?: boolean; fullBody?: boolean; includeAttachments?: boolean; includeHtml?: boolean },
) {
  const db = await prepareRipmailDb(ripmailHome)
  return readMail(db, messageId, opts)
}

/** Read a mail message for UI display, including stored HTML when available. */
export async function ripmailReadMailForDisplay(
  ripmailHome: string,
  messageId: string,
) {
  const db = await prepareRipmailDb(ripmailHome)
  return readMailForDisplay(db, ripmailHome, messageId)
}

/** Read an indexed file (Drive / localDir). */
export async function ripmailReadIndexedFile(
  ripmailHome: string,
  id: string,
  opts?: { fullBody?: boolean },
) {
  const db = await prepareRipmailDb(ripmailHome)
  return readIndexedFile(db, ripmailHome, id, opts)
}

/** List attachments for a message. */
export async function ripmailAttachmentList(ripmailHome: string, messageId: string) {
  const db = await prepareRipmailDb(ripmailHome)
  return attachmentList(db, messageId)
}

/** Read and extract text from an attachment. */
export async function ripmailAttachmentRead(
  ripmailHome: string,
  messageId: string,
  key: string | number,
) {
  const db = await prepareRipmailDb(ripmailHome)
  return attachmentRead(db, messageId, key, ripmailHome)
}

/** Return visual artifacts for a single mail attachment without extracting its text. */
export async function ripmailAttachmentVisualArtifacts(
  ripmailHome: string,
  messageId: string,
  key: string | number,
) {
  const db = await prepareRipmailDb(ripmailHome)
  const attachments = attachmentList(db, messageId)
  const wanted =
    typeof key === 'number'
      ? attachments.filter((a) => a.index === key)
      : /^\d+$/.test(key.trim())
        ? attachments.filter((a) => a.index === Number(key.trim()))
        : attachments.filter((a) => a.filename.toLowerCase() === key.trim().toLowerCase())
  return visualArtifactsFromAttachments(messageId, wanted)
}

/** Find contacts. */
export async function ripmailWho(ripmailHome: string, query?: string, opts?: { limit?: number; sourceId?: string }) {
  const db = await prepareRipmailDb(ripmailHome)
  return who(db, query, opts)
}

/** Index status. */
export async function ripmailStatus(ripmailHome: string) {
  const db = await prepareRipmailDb(ripmailHome)
  return status(db)
}

/** ParsedRipmailStatus — compatible with parseRipmailStatusJson consumers. */
export async function ripmailStatusParsed(ripmailHome: string) {
  const db = await prepareRipmailDb(ripmailHome)
  return statusParsed(db, ripmailHome)
}

/** Run inbox scan (deterministic rules). */
export async function ripmailInbox(ripmailHome: string, opts?: InboxOptions) {
  const db = await prepareRipmailDb(ripmailHome)
  return inbox(db, ripmailHome, opts)
}

/** List inbox rules. */
export function ripmailRulesList(ripmailHome: string) {
  return rulesList(ripmailHome)
}

/** Show a single rule. */
export function ripmailRulesShow(ripmailHome: string, ruleId: string) {
  return rulesShow(ripmailHome, { ruleId })
}

/** Add an inbox rule. */
export function ripmailRulesAdd(ripmailHome: string, opts: import('./rules.js').RulesAddOptions) {
  return rulesAdd(ripmailHome, opts)
}

/** Edit an inbox rule. */
export function ripmailRulesEdit(ripmailHome: string, opts: import('./rules.js').RulesEditOptions) {
  return rulesEdit(ripmailHome, opts)
}

/** Remove an inbox rule. */
export function ripmailRulesRemove(ripmailHome: string, ruleId: string) {
  return rulesRemove(ripmailHome, { ruleId })
}

/** Reorder inbox rules. */
export function ripmailRulesMove(ripmailHome: string, opts: import('./rules.js').RulesMoveOptions) {
  return rulesMove(ripmailHome, opts)
}

/** Validate inbox rules. */
export async function ripmailRulesValidate(ripmailHome: string, opts?: import('./rules.js').RulesValidateOptions) {
  const db = await prepareRipmailDb(ripmailHome)
  return rulesValidate(db, ripmailHome, opts)
}

/** List sources. */
export async function ripmailSourcesList(ripmailHome: string) {
  const db = await prepareRipmailDb(ripmailHome)
  ensureSourceRowsFromConfig(db, loadRipmailConfig(ripmailHome))
  return sourcesList(db)
}

/** Sources status. */
export async function ripmailSourcesStatus(ripmailHome: string) {
  const db = await prepareRipmailDb(ripmailHome)
  ensureSourceRowsFromConfig(db, loadRipmailConfig(ripmailHome))
  return sourcesStatus(db)
}

/** Ensure SQLite source rows exist for config.json sources. */
export async function ripmailEnsureSourceRowsFromConfig(ripmailHome: string): Promise<void> {
  const db = await prepareRipmailDb(ripmailHome)
  ensureSourceRowsFromConfig(db, loadRipmailConfig(ripmailHome))
}

/** Add local dir source. */
export async function ripmailSourcesAddLocalDir(
  ripmailHome: string,
  opts: import('./sources.js').AddLocalDirOptions,
) {
  const db = await prepareRipmailDb(ripmailHome)
  return sourcesAddLocalDir(db, opts)
}

/** Add Google Drive source. */
export async function ripmailSourcesAddGoogleDrive(
  ripmailHome: string,
  opts: import('./sources.js').AddGoogleDriveOptions,
) {
  const db = await prepareRipmailDb(ripmailHome)
  return sourcesAddGoogleDrive(db, opts)
}

/** Edit a source. */
export async function ripmailSourcesEdit(ripmailHome: string, id: string, opts: { label?: string; path?: string }) {
  const db = await prepareRipmailDb(ripmailHome)
  return sourcesEdit(db, id, opts)
}

/** Remove a source. */
export async function ripmailSourcesRemove(ripmailHome: string, id: string) {
  const db = await prepareRipmailDb(ripmailHome)
  return sourcesRemove(db, id)
}

/** Archive messages. */
export async function ripmailArchive(ripmailHome: string, messageIds: string[]) {
  const db = await prepareRipmailDb(ripmailHome)
  return archive(db, messageIds)
}

/** Unarchive messages. */
export async function ripmailUnarchive(ripmailHome: string, messageIds: string[]) {
  const db = await prepareRipmailDb(ripmailHome)
  return unarchive(db, messageIds)
}

/** Calendar range query. */
export async function ripmailCalendarRange(
  ripmailHome: string,
  from: number,
  to: number,
  opts?: { sourceIds?: string[]; calendarIds?: string[] },
) {
  const db = await prepareRipmailDb(ripmailHome)
  return calendarRange(db, from, to, opts)
}

/** List calendars. */
export async function ripmailCalendarListCalendars(ripmailHome: string, opts?: { sourceIds?: string[] }) {
  const db = await prepareRipmailDb(ripmailHome)
  return calendarListCalendars(db, opts)
}

/** Live Google Calendar calendarList API discovery for a googleCalendar source. */
export async function ripmailGoogleCalendarListCalendars(ripmailHome: string, sourceId: string) {
  const config = loadRipmailConfig(ripmailHome)
  const source = (config.sources ?? []).find((s) => s.id === sourceId && s.kind === 'googleCalendar')
  if (!source) return []
  return listGoogleCalendarsForSource(ripmailHome, source)
}

/** Create calendar event. */
export async function ripmailCalendarCreateEvent(ripmailHome: string, opts: import('./calendar.js').CreateEventOptions) {
  const db = await prepareRipmailDb(ripmailHome)
  return calendarCreateEvent(db, opts)
}

/** Update calendar event. */
export async function ripmailCalendarUpdateEvent(
  ripmailHome: string,
  uid: string,
  updates: Parameters<typeof calendarUpdateEvent>[2],
) {
  const db = await prepareRipmailDb(ripmailHome)
  return calendarUpdateEvent(db, uid, updates)
}

/** Cancel calendar event. Google Calendar uses the live API; other source kinds update SQLite only. */
export async function ripmailCalendarCancelEvent(
  ripmailHome: string,
  sourceId: string,
  uid: string,
  scope: 'this' | 'future' | 'all' = 'this',
) {
  if (scope === 'future') {
    throw new Error(
      'Calendar: cancel_event with scope=future is not supported yet. Use scope=this (one occurrence) or scope=all (entire series).',
    )
  }
  const sid = sourceId.trim()
  const id = uid.trim()
  const db = await prepareRipmailDb(ripmailHome)
  const row = db
    .prepare(
      `SELECT source_kind, calendar_id, raw_json FROM calendar_events WHERE source_id = ? AND uid = ?`,
    )
    .get(sid, id) as
    | { source_kind: string; calendar_id: string; raw_json: string | null }
    | undefined
  if (!row) {
    throw new Error(
      `Calendar event not found in the local index (source_id=${sid}, uid=${id}). Use the compound event_id from op=events or search, then sync calendars if needed.`,
    )
  }
  if (row.source_kind === 'googleCalendar') {
    const cfg = loadRipmailConfig(ripmailHome)
    const source = cfg.sources?.find((s) => s.id === sid)
    if (!source || source.kind !== 'googleCalendar') {
      throw new Error(`googleCalendar source not found in config: ${sid}`)
    }
    await cancelGoogleCalendarEventRemote(db, ripmailHome, source, row.calendar_id, id, row.raw_json, scope)
    return
  }
  const info = db.prepare(`UPDATE calendar_events SET status = 'cancelled' WHERE source_id = ? AND uid = ?`).run(sid, id)
  if (info.changes === 0) {
    throw new Error(`Calendar event not found for cancel (source_id=${sid}, uid=${id}).`)
  }
}

/** Delete calendar event. Google Calendar uses the live API; other source kinds delete from SQLite only. */
export async function ripmailCalendarDeleteEvent(
  ripmailHome: string,
  sourceId: string,
  uid: string,
  scope: 'this' | 'all' = 'this',
) {
  const sid = sourceId.trim()
  const id = uid.trim()
  const db = await prepareRipmailDb(ripmailHome)
  const row = db
    .prepare(
      `SELECT source_kind, calendar_id, raw_json FROM calendar_events WHERE source_id = ? AND uid = ?`,
    )
    .get(sid, id) as
    | { source_kind: string; calendar_id: string; raw_json: string | null }
    | undefined
  if (!row) {
    throw new Error(
      `Calendar event not found in the local index (source_id=${sid}, uid=${id}). Use the compound event_id from op=events or search, then sync calendars if needed.`,
    )
  }
  if (row.source_kind === 'googleCalendar') {
    const cfg = loadRipmailConfig(ripmailHome)
    const source = cfg.sources?.find((s) => s.id === sid)
    if (!source || source.kind !== 'googleCalendar') {
      throw new Error(`googleCalendar source not found in config: ${sid}`)
    }
    await deleteGoogleCalendarEventRemote(db, ripmailHome, source, row.calendar_id, id, row.raw_json, scope)
    return
  }
  const info = db.prepare(`DELETE FROM calendar_events WHERE source_id = ? AND uid = ?`).run(sid, id)
  if (info.changes === 0) {
    throw new Error(`Calendar event not found for delete (source_id=${sid}, uid=${id}).`)
  }
}

/** Create draft. */
export async function ripmailDraftNew(ripmailHome: string, opts: import('./draft.js').NewDraftOptions) {
  const db = await prepareRipmailDb(ripmailHome)
  return draftNew(db, ripmailHome, opts)
}

/** Reply draft. */
export async function ripmailDraftReply(ripmailHome: string, opts: import('./draft.js').ReplyDraftOptions) {
  const db = await prepareRipmailDb(ripmailHome)
  return draftReply(db, ripmailHome, opts)
}

/** Forward draft. */
export async function ripmailDraftForward(ripmailHome: string, opts: import('./draft.js').ForwardDraftOptions) {
  const db = await prepareRipmailDb(ripmailHome)
  return draftForward(db, ripmailHome, opts)
}

/** Edit draft. */
export function ripmailDraftEdit(ripmailHome: string, draftId: string, opts: import('./draft.js').EditDraftOptions) {
  return draftEdit(ripmailHome, draftId, opts)
}

/** Delete draft file on disk. */
export function ripmailDraftDelete(ripmailHome: string, draftId: string) {
  return draftDelete(ripmailHome, draftId)
}

/** View draft. */
export function ripmailDraftView(ripmailHome: string, draftId: string) {
  return draftView(ripmailHome, draftId)
}

/** List drafts. */
export function ripmailDraftList(ripmailHome: string) {
  return draftList(ripmailHome)
}

/** Send a draft. */
export function ripmailSend(ripmailHome: string, draftId: string, opts?: import('./send.js').SendOptions) {
  return send(ripmailHome, draftId, opts)
}

/** Trigger incremental sync (background). Phase 2 full implementation. */
export function ripmailRefresh(ripmailHome: string, opts?: import('./types.js').RefreshOptions) {
  return refresh(ripmailHome, opts)
}
