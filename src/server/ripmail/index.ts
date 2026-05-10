/**
 * ripmail TypeScript module — public API.
 *
 * All operations take a `ripmailHome` path (the per-tenant ripmail directory,
 * e.g. `<BRAIN_DATA_ROOT>/<tenant>/ripmail`) and return typed objects.
 *
 * This module replaces the `execRipmailAsync` subprocess path:
 *   Before: execRipmailAsync(`${bin} search "query" --json`)
 *   After:  import { ripmailSearch } from '@server/ripmail/index.js'
 *           ripmailSearch(ripmailHome, { query: 'query', limit: 20 })
 */

export { openRipmailDb, closeRipmailDb, invalidateRipmailDbCache, openMemoryRipmailDb, ripmailDbPath } from './db.js'
export { SCHEMA_VERSION } from './schema.js'

export type {
  SearchOptions,
  SearchResult,
  SearchResultSet,
  SearchTimings,
  ReadMailResult,
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

import { openRipmailDb } from './db.js'
import { search } from './search.js'
import { readMail, readIndexedFile } from './mailRead.js'
import { attachmentList, attachmentRead } from './attachments.js'
import { who } from './who.js'
import { status, statusParsed } from './status.js'
import { inbox } from './inbox.js'
import { rulesList, rulesShow, rulesAdd, rulesEdit, rulesRemove, rulesMove, rulesValidate } from './rules.js'
import { sourcesList, sourcesStatus, sourcesAddLocalDir, sourcesAddGoogleDrive, sourcesEdit, sourcesRemove } from './sources.js'
import { archive, unarchive } from './archive.js'
import { calendarRange, calendarListCalendars, calendarCreateEvent, calendarUpdateEvent, calendarCancelEvent, calendarDeleteEvent } from './calendar.js'
import { draftNew, draftReply, draftForward, draftEdit, draftView, draftList } from './draft.js'
import { send } from './send.js'
import { refresh } from './sync/index.js'
export { loadRipmailConfig, saveRipmailConfig } from './sync/config.js'
import type { SearchOptions, InboxOptions } from './inbox.js'

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
export function ripmailSearch(ripmailHome: string, opts: SearchOptions) {
  const db = openRipmailDb(ripmailHome)
  return search(db, opts)
}

/** Read a mail message by Message-ID. */
export function ripmailReadMail(
  ripmailHome: string,
  messageId: string,
  opts?: { plainBody?: boolean; fullBody?: boolean; includeAttachments?: boolean },
) {
  const db = openRipmailDb(ripmailHome)
  return readMail(db, messageId, opts)
}

/** Read an indexed file (Drive / localDir). */
export function ripmailReadIndexedFile(
  ripmailHome: string,
  id: string,
  opts?: { fullBody?: boolean },
) {
  const db = openRipmailDb(ripmailHome)
  return readIndexedFile(db, id, opts)
}

/** List attachments for a message. */
export function ripmailAttachmentList(ripmailHome: string, messageId: string) {
  const db = openRipmailDb(ripmailHome)
  return attachmentList(db, messageId)
}

/** Read and extract text from an attachment. */
export async function ripmailAttachmentRead(
  ripmailHome: string,
  messageId: string,
  key: string | number,
) {
  const db = openRipmailDb(ripmailHome)
  return attachmentRead(db, messageId, key, ripmailHome)
}

/** Find contacts. */
export function ripmailWho(ripmailHome: string, query?: string, opts?: { limit?: number; sourceId?: string }) {
  const db = openRipmailDb(ripmailHome)
  return who(db, query, opts)
}

/** Index status. */
export function ripmailStatus(ripmailHome: string) {
  const db = openRipmailDb(ripmailHome)
  return status(db)
}

/** ParsedRipmailStatus — compatible with parseRipmailStatusJson consumers. */
export function ripmailStatusParsed(ripmailHome: string) {
  const db = openRipmailDb(ripmailHome)
  return statusParsed(db)
}

/** Run inbox scan (deterministic rules). */
export function ripmailInbox(ripmailHome: string, opts?: InboxOptions) {
  const db = openRipmailDb(ripmailHome)
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
export function ripmailRulesValidate(ripmailHome: string, opts?: import('./rules.js').RulesValidateOptions) {
  const db = openRipmailDb(ripmailHome)
  return rulesValidate(db, ripmailHome, opts)
}

/** List sources. */
export function ripmailSourcesList(ripmailHome: string) {
  const db = openRipmailDb(ripmailHome)
  return sourcesList(db)
}

/** Sources status. */
export function ripmailSourcesStatus(ripmailHome: string) {
  const db = openRipmailDb(ripmailHome)
  return sourcesStatus(db)
}

/** Add local dir source. */
export function ripmailSourcesAddLocalDir(ripmailHome: string, opts: import('./sources.js').AddLocalDirOptions) {
  const db = openRipmailDb(ripmailHome)
  return sourcesAddLocalDir(db, opts)
}

/** Add Google Drive source. */
export function ripmailSourcesAddGoogleDrive(ripmailHome: string, opts: import('./sources.js').AddGoogleDriveOptions) {
  const db = openRipmailDb(ripmailHome)
  return sourcesAddGoogleDrive(db, opts)
}

/** Edit a source. */
export function ripmailSourcesEdit(ripmailHome: string, id: string, opts: { label?: string; path?: string }) {
  const db = openRipmailDb(ripmailHome)
  return sourcesEdit(db, id, opts)
}

/** Remove a source. */
export function ripmailSourcesRemove(ripmailHome: string, id: string) {
  const db = openRipmailDb(ripmailHome)
  return sourcesRemove(db, id)
}

/** Archive messages. */
export function ripmailArchive(ripmailHome: string, messageIds: string[]) {
  const db = openRipmailDb(ripmailHome)
  return archive(db, messageIds)
}

/** Unarchive messages. */
export function ripmailUnarchive(ripmailHome: string, messageIds: string[]) {
  const db = openRipmailDb(ripmailHome)
  return unarchive(db, messageIds)
}

/** Calendar range query. */
export function ripmailCalendarRange(
  ripmailHome: string,
  from: number,
  to: number,
  opts?: { sourceIds?: string[]; calendarIds?: string[] },
) {
  const db = openRipmailDb(ripmailHome)
  return calendarRange(db, from, to, opts)
}

/** List calendars. */
export function ripmailCalendarListCalendars(ripmailHome: string, opts?: { sourceIds?: string[] }) {
  const db = openRipmailDb(ripmailHome)
  return calendarListCalendars(db, opts)
}

/** Create calendar event. */
export function ripmailCalendarCreateEvent(ripmailHome: string, opts: import('./calendar.js').CreateEventOptions) {
  const db = openRipmailDb(ripmailHome)
  return calendarCreateEvent(db, opts)
}

/** Update calendar event. */
export function ripmailCalendarUpdateEvent(
  ripmailHome: string,
  uid: string,
  updates: Parameters<typeof calendarUpdateEvent>[2],
) {
  const db = openRipmailDb(ripmailHome)
  return calendarUpdateEvent(db, uid, updates)
}

/** Cancel calendar event. */
export function ripmailCalendarCancelEvent(ripmailHome: string, uid: string) {
  const db = openRipmailDb(ripmailHome)
  return calendarCancelEvent(db, uid)
}

/** Delete calendar event. */
export function ripmailCalendarDeleteEvent(ripmailHome: string, uid: string) {
  const db = openRipmailDb(ripmailHome)
  return calendarDeleteEvent(db, uid)
}

/** Create draft. */
export function ripmailDraftNew(ripmailHome: string, opts: import('./draft.js').NewDraftOptions) {
  const db = openRipmailDb(ripmailHome)
  return draftNew(db, ripmailHome, opts)
}

/** Reply draft. */
export function ripmailDraftReply(ripmailHome: string, opts: import('./draft.js').ReplyDraftOptions) {
  const db = openRipmailDb(ripmailHome)
  return draftReply(db, ripmailHome, opts)
}

/** Forward draft. */
export function ripmailDraftForward(ripmailHome: string, opts: import('./draft.js').ForwardDraftOptions) {
  const db = openRipmailDb(ripmailHome)
  return draftForward(db, ripmailHome, opts)
}

/** Edit draft. */
export function ripmailDraftEdit(ripmailHome: string, draftId: string, opts: import('./draft.js').EditDraftOptions) {
  return draftEdit(ripmailHome, draftId, opts)
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
