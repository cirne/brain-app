import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Nanoseconds since 2001-01-01 UTC (Core Data / Messages convention). */
export function appleDateNsToUnixMs(ns: number): number {
  return 978307200_000 + ns / 1e6
}

export function unixMsToAppleDateNs(ms: number): number {
  return 1e6 * (ms - 978307200_000)
}

export function getImessageDbPath(): string {
  return process.env.IMESSAGE_DB_PATH ?? join(homedir(), 'Library', 'Messages', 'chat.db')
}

export interface ImessageRow {
  rowid: number
  text: string | null
  date: number
  is_from_me: number
  is_read: number
  chat_identifier: string | null
  display_name: string | null
}

export interface ListRecentParams {
  /** Inclusive lower bound (Unix ms). If omitted, defaults to `defaultSinceMs`. */
  sinceMs?: number
  /** Inclusive upper bound (Unix ms). If omitted, now. */
  untilMs?: number
  unread_only?: boolean
  /** Exact `chat.chat_identifier` match (e.g. +15551234567). */
  chat_identifier?: string
  limit?: number
}

export interface ThreadParams {
  chat_identifier: string
  sinceMs?: number
  untilMs?: number
  limit?: number
}

function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

/**
 * List recent messages across chats (read-only). Requires local macOS `chat.db` or `IMESSAGE_DB_PATH`.
 */
export function listRecentMessages(dbPath: string, params: ListRecentParams & { defaultSinceMs: number }): {
  messages: ImessageRow[]
  error?: string
} {
  let db: Database.Database
  try {
    db = openReadonly(dbPath)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      messages: [],
      error: `Cannot open Messages database at ${dbPath}: ${msg}. On macOS grant Full Disk Access to your terminal or Node, or set IMESSAGE_DB_PATH to a readable copy.`,
    }
  }

  try {
    const untilMs = params.untilMs ?? Date.now()
    const sinceMs = params.sinceMs ?? params.defaultSinceMs
    const sinceNs = unixMsToAppleDateNs(sinceMs)
    const untilNs = unixMsToAppleDateNs(untilMs)
    const limit = Math.min(Math.max(params.limit ?? 30, 1), 200)
    const unread = params.unread_only === true

    let sql = `
      SELECT
        m.ROWID AS rowid,
        m.text AS text,
        m.date AS date,
        m.is_from_me AS is_from_me,
        m.is_read AS is_read,
        c.chat_identifier AS chat_identifier,
        c.display_name AS display_name
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE m.date >= @sinceNs AND m.date <= @untilNs
    `
    if (unread) {
      sql += ` AND m.is_read = 0 AND m.is_from_me = 0 AND m.is_finished = 1 AND m.item_type = 0 AND m.is_system_message = 0`
    }
    if (params.chat_identifier) {
      sql += ` AND c.chat_identifier = @chatId`
    }
    sql += ` ORDER BY m.date DESC LIMIT @limit`

    const bind: Record<string, string | number> = { sinceNs, untilNs, limit }
    if (params.chat_identifier) bind.chatId = params.chat_identifier

    const stmt = db.prepare(sql)
    const rows = stmt.all(bind) as ImessageRow[]

    return { messages: rows }
  } finally {
    db.close()
  }
}

/**
 * Messages for one conversation (`chat.chat_identifier`), oldest first for reading order.
 */
export function getThreadMessages(dbPath: string, params: ThreadParams & { defaultSinceMs: number }): {
  messages: ImessageRow[]
  message_count: number
  error?: string
} {
  let db: Database.Database
  try {
    db = openReadonly(dbPath)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      messages: [],
      message_count: 0,
      error: `Cannot open Messages database at ${dbPath}: ${msg}. On macOS grant Full Disk Access to your terminal or Node, or set IMESSAGE_DB_PATH to a readable copy.`,
    }
  }

  try {
    const untilMs = params.untilMs ?? Date.now()
    const sinceMs = params.sinceMs ?? params.defaultSinceMs
    const sinceNs = unixMsToAppleDateNs(sinceMs)
    const untilNs = unixMsToAppleDateNs(untilMs)
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500)

    const countStmt = db.prepare(`
      SELECT COUNT(*) AS n
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier = @chatId
        AND m.date >= @sinceNs AND m.date <= @untilNs
    `)
    const countRow = countStmt.get({
      chatId: params.chat_identifier,
      sinceNs,
      untilNs,
    }) as { n: number }
    const message_count = countRow?.n ?? 0

    const stmt = db.prepare(`
      SELECT
        m.ROWID AS rowid,
        m.text AS text,
        m.date AS date,
        m.is_from_me AS is_from_me,
        m.is_read AS is_read,
        c.chat_identifier AS chat_identifier,
        c.display_name AS display_name
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier = @chatId
        AND m.date >= @sinceNs AND m.date <= @untilNs
      ORDER BY m.date ASC
      LIMIT @limit
    `)
    const messages = stmt.all({
      chatId: params.chat_identifier,
      sinceNs,
      untilNs,
      limit,
    }) as ImessageRow[]

    return { messages, message_count }
  } finally {
    db.close()
  }
}
