import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'

export interface IngestImessageRow {
  guid: string
  rowid: number
  date_ms: number
  text: string | null
  is_from_me: boolean
  handle: string | null
  chat_identifier: string | null
  display_name?: string | null
  contact_identifier?: string | null
  organization?: string | null
  service?: string | null
}

export interface StoredImessageRow {
  rowid_local: number
  device_id: string
  source_rowid: number
  guid: string
  date_ms: number
  text: string | null
  is_from_me: number
  handle: string | null
  chat_identifier: string | null
  display_name: string | null
  contact_identifier: string | null
  organization: string | null
  service: string | null
  ingested_at_ms: number
}

export interface StoredThreadParams {
  chat_identifier: string
  sinceMs?: number
  untilMs?: number
  limit?: number
  defaultSinceMs: number
}

export interface StoredThreadRow {
  text: string | null
  date_ms: number
  is_from_me: number
  chat_identifier: string | null
  display_name: string | null
}

function messagesDbPath(): string {
  return join(brainLayoutVarDir(brainHome()), 'messages.sqlite')
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS imessage_messages (
      rowid_local INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      source_rowid INTEGER NOT NULL,
      guid TEXT NOT NULL,
      date_ms INTEGER NOT NULL,
      text TEXT,
      is_from_me INTEGER NOT NULL,
      handle TEXT,
      chat_identifier TEXT,
      display_name TEXT,
      contact_identifier TEXT,
      organization TEXT,
      service TEXT,
      raw_json TEXT,
      ingested_at_ms INTEGER NOT NULL,
      UNIQUE(device_id, source_rowid),
      UNIQUE(guid)
    );
    CREATE INDEX IF NOT EXISTS idx_imessage_messages_device_rowid
      ON imessage_messages(device_id, source_rowid);
    CREATE INDEX IF NOT EXISTS idx_imessage_messages_chat_date
      ON imessage_messages(chat_identifier, date_ms);
    CREATE VIRTUAL TABLE IF NOT EXISTS imessage_messages_fts USING fts5(
      text,
      content='imessage_messages',
      content_rowid='rowid_local'
    );
    CREATE TRIGGER IF NOT EXISTS imessage_messages_ai AFTER INSERT ON imessage_messages BEGIN
      INSERT INTO imessage_messages_fts(rowid, text) VALUES (new.rowid_local, COALESCE(new.text, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS imessage_messages_ad AFTER DELETE ON imessage_messages BEGIN
      INSERT INTO imessage_messages_fts(imessage_messages_fts, rowid, text) VALUES('delete', old.rowid_local, COALESCE(old.text, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS imessage_messages_au AFTER UPDATE ON imessage_messages BEGIN
      INSERT INTO imessage_messages_fts(imessage_messages_fts, rowid, text) VALUES('delete', old.rowid_local, COALESCE(old.text, ''));
      INSERT INTO imessage_messages_fts(rowid, text) VALUES (new.rowid_local, COALESCE(new.text, ''));
    END;
  `)
}

function openMessagesDb(): Database.Database {
  const path = messagesDbPath()
  mkdirSync(brainLayoutVarDir(brainHome()), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  ensureSchema(db)
  return db
}

function getCursorForDeviceWithDb(db: Database.Database, deviceId: string): number {
  const row = db
    .prepare(
      `SELECT MAX(source_rowid) AS max_rowid
       FROM imessage_messages
       WHERE device_id = ?`,
    )
    .get(deviceId) as { max_rowid: number | null }
  return row.max_rowid ?? 0
}

function toStoredIngestedRow(
  row: IngestImessageRow,
): Omit<StoredImessageRow, 'rowid_local' | 'ingested_at_ms' | 'device_id'> {
  return {
    source_rowid: row.rowid,
    guid: row.guid,
    date_ms: row.date_ms,
    text: row.text,
    is_from_me: row.is_from_me ? 1 : 0,
    handle: row.handle,
    chat_identifier: row.chat_identifier,
    display_name: row.display_name ?? null,
    contact_identifier: row.contact_identifier ?? null,
    organization: row.organization ?? null,
    service: row.service ?? 'iMessage',
  }
}

export function upsertImessageBatch(
  deviceId: string,
  rows: IngestImessageRow[],
): { accepted: number; lastRowid: number } {
  if (!deviceId || deviceId.trim().length === 0) {
    throw new Error('device_id_required')
  }
  const db = openMessagesDb()
  try {
    const now = Date.now()
    const findStmt = db.prepare(
      `SELECT rowid_local
       FROM imessage_messages
       WHERE guid = ? OR (device_id = ? AND source_rowid = ?)
       LIMIT 1`,
    )
    const insertStmt = db.prepare(
      `INSERT INTO imessage_messages (
          device_id, source_rowid, guid, date_ms, text, is_from_me, handle,
          chat_identifier, display_name, contact_identifier, organization, service, raw_json, ingested_at_ms
        ) VALUES (
          @device_id, @source_rowid, @guid, @date_ms, @text, @is_from_me, @handle,
          @chat_identifier, @display_name, @contact_identifier, @organization, @service, @raw_json, @ingested_at_ms
        )`,
    )
    const updateStmt = db.prepare(
      `UPDATE imessage_messages SET
         device_id = @device_id,
         source_rowid = @source_rowid,
         guid = @guid,
         date_ms = @date_ms,
         text = @text,
         is_from_me = @is_from_me,
         handle = @handle,
         chat_identifier = @chat_identifier,
         display_name = @display_name,
         contact_identifier = @contact_identifier,
         organization = @organization,
         service = @service,
         raw_json = @raw_json,
         ingested_at_ms = @ingested_at_ms
       WHERE rowid_local = @rowid_local`,
    )
    const tx = db.transaction((input: IngestImessageRow[]) => {
      let accepted = 0
      for (const raw of input) {
        if (!raw.guid || typeof raw.rowid !== 'number') continue
        const row = toStoredIngestedRow(raw)
        const payload = {
          ...row,
          device_id: deviceId,
          raw_json: JSON.stringify(raw),
          ingested_at_ms: now,
        }
        const existing = findStmt.get(row.guid, deviceId, row.source_rowid) as
          | { rowid_local: number }
          | undefined
        if (existing) {
          updateStmt.run({ ...payload, rowid_local: existing.rowid_local })
        } else {
          insertStmt.run(payload)
        }
        accepted += 1
      }
      return accepted
    })
    const accepted = tx(rows)
    const lastRowid = getCursorForDeviceWithDb(db, deviceId)
    return { accepted, lastRowid }
  } finally {
    db.close()
  }
}

export function getImessageCursorForDevice(deviceId: string): number {
  if (!deviceId || deviceId.trim().length === 0) return 0
  const db = openMessagesDb()
  try {
    return getCursorForDeviceWithDb(db, deviceId)
  } finally {
    db.close()
  }
}

export function wipeImessageMessages(): number {
  const db = openMessagesDb()
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM imessage_messages').get() as { n: number }
    db.prepare('DELETE FROM imessage_messages').run()
    db.prepare("INSERT INTO imessage_messages_fts(imessage_messages_fts) VALUES('rebuild')").run()
    return row.n ?? 0
  } finally {
    db.close()
  }
}

export function getStoredThreadMessages(
  params: StoredThreadParams,
): { messages: StoredThreadRow[]; message_count: number } {
  const db = openMessagesDb()
  try {
    const sinceMs = params.sinceMs ?? params.defaultSinceMs
    const untilMs = params.untilMs ?? Date.now()
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500)
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM imessage_messages
         WHERE chat_identifier = @chatId
           AND date_ms >= @sinceMs
           AND date_ms <= @untilMs`,
      )
      .get({
        chatId: params.chat_identifier,
        sinceMs,
        untilMs,
      }) as { n: number }
    const rows = db
      .prepare(
        `SELECT text, date_ms, is_from_me, chat_identifier, display_name
         FROM imessage_messages
         WHERE chat_identifier = @chatId
           AND date_ms >= @sinceMs
           AND date_ms <= @untilMs
         ORDER BY date_ms ASC
         LIMIT @limit`,
      )
      .all({
        chatId: params.chat_identifier,
        sinceMs,
        untilMs,
        limit,
      }) as StoredThreadRow[]
    return {
      messages: rows,
      message_count: countRow?.n ?? 0,
    }
  } finally {
    db.close()
  }
}

export function searchImessageMessages(query: string, limit: number = 20): StoredImessageRow[] {
  const q = query.trim()
  if (q.length === 0) return []
  const capped = Math.min(Math.max(limit, 1), 200)
  const db = openMessagesDb()
  try {
    return db
      .prepare(
        `SELECT m.*
         FROM imessage_messages_fts f
         JOIN imessage_messages m ON m.rowid_local = f.rowid
         WHERE imessage_messages_fts MATCH ?
         ORDER BY m.date_ms DESC
         LIMIT ?`,
      )
      .all(q, capped) as StoredImessageRow[]
  } finally {
    db.close()
  }
}
