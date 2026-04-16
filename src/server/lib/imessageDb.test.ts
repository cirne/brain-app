import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import {
  appleDateNsToUnixMs,
  unixMsToAppleDateNs,
  areLocalMessageToolsEnabled,
  extractTextFromAttributedBody,
  initLocalMessageToolsAvailability,
  listRecentMessages,
  getThreadMessages,
  probeImessageDbReadable,
  resetLocalMessageToolsAvailabilityForTests,
} from './imessageDb.js'

let dir: string
let dbPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'imessage-db-test-'))
  dbPath = join(dir, 'chat.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
      guid TEXT UNIQUE NOT NULL,
      text TEXT,
      attributedBody BLOB,
      date INTEGER,
      is_from_me INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      is_finished INTEGER DEFAULT 1,
      item_type INTEGER DEFAULT 0,
      is_system_message INTEGER DEFAULT 0,
      handle_id INTEGER DEFAULT 0
    );
    CREATE TABLE chat (
      ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
      guid TEXT UNIQUE NOT NULL,
      chat_identifier TEXT,
      display_name TEXT
    );
    CREATE TABLE chat_message_join (
      chat_id INTEGER,
      message_id INTEGER,
      message_date INTEGER DEFAULT 0,
      index_state INTEGER NOT NULL DEFAULT 2,
      PRIMARY KEY (chat_id, message_id)
    );
  `)

  const t1 = unixMsToAppleDateNs(Date.parse('2026-04-01T12:00:00.000Z'))
  const t2 = unixMsToAppleDateNs(Date.parse('2026-04-02T12:00:00.000Z'))

  db.prepare(
    `INSERT INTO chat (guid, chat_identifier, display_name) VALUES (?, ?, ?)`,
  ).run('chat-guid-1', '+15550001111', 'Alice')

  const m1 = db
    .prepare(`INSERT INTO message (guid, text, date, is_from_me, is_read) VALUES (?, ?, ?, ?, ?)`)
    .run('msg-guid-1', 'Hello', t1, 0, 1)
  const m2 = db
    .prepare(`INSERT INTO message (guid, text, date, is_from_me, is_read) VALUES (?, ?, ?, ?, ?)`)
    .run('msg-guid-2', 'Reply', t2, 1, 1)

  const chatRow = db.prepare(`SELECT ROWID FROM chat WHERE chat_identifier = ?`).get('+15550001111') as { ROWID: number }

  db.prepare(`INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)`).run(
    chatRow.ROWID,
    m1.lastInsertRowid,
    t1,
  )
  db.prepare(`INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)`).run(
    chatRow.ROWID,
    m2.lastInsertRowid,
    t2,
  )

  db.close()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('imessageDb', () => {
  it('converts Apple date ns to Unix ms and back', () => {
    const ns = unixMsToAppleDateNs(Date.parse('2026-04-14T10:00:00.000Z'))
    const back = appleDateNsToUnixMs(ns)
    expect(new Date(back).toISOString()).toBe('2026-04-14T10:00:00.000Z')
  })

  it('listRecentMessages returns rows in time window', () => {
    const since = Date.parse('2026-03-01T00:00:00.000Z')
    const until = Date.parse('2026-05-01T00:00:00.000Z')
    const { messages, error } = listRecentMessages(dbPath, {
      sinceMs: since,
      untilMs: until,
      defaultSinceMs: since,
    })
    expect(error).toBeUndefined()
    expect(messages).toHaveLength(2)
    expect(messages[0].text).toBe('Reply')
    expect(messages[1].text).toBe('Hello')
  })

  it('listRecentMessages filters by chat_identifier', () => {
    const since = Date.parse('2026-03-01T00:00:00.000Z')
    const until = Date.parse('2026-05-01T00:00:00.000Z')
    const { messages, error } = listRecentMessages(dbPath, {
      sinceMs: since,
      untilMs: until,
      chat_identifier: '+15550001111',
      defaultSinceMs: since,
    })
    expect(error).toBeUndefined()
    expect(messages).toHaveLength(2)
  })

  it('getThreadMessages returns oldest first and count', () => {
    const since = Date.parse('2026-03-01T00:00:00.000Z')
    const until = Date.parse('2026-05-01T00:00:00.000Z')
    const { messages, message_count, error } = getThreadMessages(dbPath, {
      chat_identifier: '+15550001111',
      sinceMs: since,
      untilMs: until,
      defaultSinceMs: since,
    })
    expect(error).toBeUndefined()
    expect(message_count).toBe(2)
    expect(messages.map((m) => m.text)).toEqual(['Hello', 'Reply'])
  })

  describe('extractTextFromAttributedBody', () => {
    it('extracts text from a minimal NSAttributedString blob', () => {
      // Build a minimal blob: preamble + marker 0x01 0x2B + length + text
      const preamble = Buffer.from('streamtyped-preamble-junk', 'utf8')
      const marker = Buffer.from([0x01, 0x2B])
      const text = 'Hello from blob'
      const len = Buffer.byteLength(text, 'utf8')
      const body = Buffer.concat([preamble, marker, Buffer.from([len]), Buffer.from(text, 'utf8')])
      expect(extractTextFromAttributedBody(body)).toBe('Hello from blob')
    })

    it('handles 2-byte length for messages >= 128 bytes', () => {
      const preamble = Buffer.from([0x04, 0x0B])
      const marker = Buffer.from([0x01, 0x2B])
      const text = 'A'.repeat(200)
      const len = Buffer.byteLength(text, 'utf8')
      const lenBytes = Buffer.from([len & 0x7f | 0x80, len >> 7])
      const body = Buffer.concat([preamble, marker, lenBytes, Buffer.from(text, 'utf8')])
      expect(extractTextFromAttributedBody(body)).toBe(text)
    })

    it('strips null bytes from text', () => {
      const marker = Buffer.from([0x01, 0x2B])
      const text = '\0Hello\0'
      const body = Buffer.concat([marker, Buffer.from([text.length]), Buffer.from(text, 'utf8')])
      expect(extractTextFromAttributedBody(body)).toBe('Hello')
    })

    it('returns null when marker is missing', () => {
      expect(extractTextFromAttributedBody(Buffer.from('no marker here'))).toBeNull()
    })
  })

  it('falls back to attributedBody when text is null', () => {
    const db = new Database(dbPath)
    const t3 = unixMsToAppleDateNs(Date.parse('2026-04-03T12:00:00.000Z'))
    const marker = Buffer.from([0x01, 0x2B])
    const bodyText = 'Blob fallback text'
    const blob = Buffer.concat([
      Buffer.from('preamble-junk', 'utf8'),
      marker,
      Buffer.from([bodyText.length]),
      Buffer.from(bodyText, 'utf8'),
    ])
    const m3 = db
      .prepare(`INSERT INTO message (guid, text, attributedBody, date, is_from_me, is_read) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('msg-guid-3', null, blob, t3, 0, 0)
    const chatRow = db.prepare(`SELECT ROWID FROM chat WHERE chat_identifier = ?`).get('+15550001111') as { ROWID: number }
    db.prepare(`INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)`).run(
      chatRow.ROWID,
      m3.lastInsertRowid,
      t3,
    )
    db.close()

    const since = Date.parse('2026-04-03T00:00:00.000Z')
    const until = Date.parse('2026-04-04T00:00:00.000Z')
    const { messages } = listRecentMessages(dbPath, {
      sinceMs: since,
      untilMs: until,
      defaultSinceMs: since,
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].text).toBe('Blob fallback text')
  })

  describe('availability probe', () => {
    beforeEach(() => {
      process.env.IMESSAGE_DB_PATH = dbPath
      resetLocalMessageToolsAvailabilityForTests()
    })

    afterEach(() => {
      delete process.env.IMESSAGE_DB_PATH
      resetLocalMessageToolsAvailabilityForTests()
    })

    it('probeImessageDbReadable returns true for readable db', () => {
      expect(probeImessageDbReadable()).toBe(true)
    })

    it('initLocalMessageToolsAvailability enables tools when db is readable', () => {
      initLocalMessageToolsAvailability()
      expect(areLocalMessageToolsEnabled()).toBe(true)
    })

    it('probeImessageDbReadable returns false when path does not exist', () => {
      process.env.IMESSAGE_DB_PATH = join(dir, 'missing-chat.db')
      resetLocalMessageToolsAvailabilityForTests()
      expect(probeImessageDbReadable()).toBe(false)
    })
  })
})
