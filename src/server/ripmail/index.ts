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

import { prepareRipmailDb } from './db.js'
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
  opts?: { plainBody?: boolean; fullBody?: boolean; includeAttachments?: boolean },
) {
  const db = await prepareRipmailDb(ripmailHome)
  return readMail(db, messageId, opts)
}

/** Read an indexed file (Drive / localDir). */
export async function ripmailReadIndexedFile(
  ripmailHome: string,
  id: string,
  opts?: { fullBody?: boolean },
) {
  const db = await prepareRipmailDb(ripmailHome)
  return readIndexedFile(db, id, opts)
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
  return sourcesList(db)
}

/** Sources status. */
export async function ripmailSourcesStatus(ripmailHome: string) {
  const db = await prepareRipmailDb(ripmailHome)
  return sourcesStatus(db)
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

/** Cancel calendar event. */
export async function ripmailCalendarCancelEvent(ripmailHome: string, uid: string) {
  const db = await prepareRipmailDb(ripmailHome)
  return calendarCancelEvent(db, uid)
}

/** Delete calendar event. */
export async function ripmailCalendarDeleteEvent(ripmailHome: string, uid: string) {
  const db = await prepareRipmailDb(ripmailHome)
  return calendarDeleteEvent(db, uid)
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
