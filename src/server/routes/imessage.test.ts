import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import {
  initLocalMessageToolsAvailability,
  resetLocalMessageToolsAvailabilityForTests,
  unixMsToAppleDateNs,
} from '@server/lib/apple/imessageDb.js'
import { upsertImessageBatch } from '@server/lib/messages/messagesDb.js'

let dir: string
let dbPath: string
let app: Hono

beforeEach(async () => {
  process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = '1'
  dir = await mkdtemp(join(tmpdir(), 'imessage-api-test-'))
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

  const now = Date.now()
  const t1 = unixMsToAppleDateNs(now - 2 * 24 * 60 * 60 * 1000)
  const t2 = unixMsToAppleDateNs(now - 1 * 24 * 60 * 60 * 1000)

  db.prepare(`INSERT INTO chat (guid, chat_identifier, display_name) VALUES (?, ?, ?)`).run(
    'chat-guid-1',
    '+15550001111',
    'Alice',
  )

  const m1 = db
    .prepare(`INSERT INTO message (guid, text, date, is_from_me, is_read) VALUES (?, ?, ?, ?, ?)`)
    .run('msg-guid-1', 'Hello', t1, 0, 1)
  const m2 = db
    .prepare(`INSERT INTO message (guid, text, date, is_from_me, is_read) VALUES (?, ?, ?, ?, ?)`)
    .run('msg-guid-2', 'Reply', t2, 1, 1)

  const chatRow = db.prepare(`SELECT ROWID FROM chat WHERE chat_identifier = ?`).get('+15550001111') as {
    ROWID: number
  }

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

  process.env.IMESSAGE_DB_PATH = dbPath
  process.env.BRAIN_HOME = dir
  resetLocalMessageToolsAvailabilityForTests()
  initLocalMessageToolsAvailability()

  const { default: imessageRoute } = await import('./imessage.js')
  app = new Hono()
  app.route('/api/imessage', imessageRoute)
  app.route('/api/messages', imessageRoute)
})

afterEach(async () => {
  delete process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
  delete process.env.IMESSAGE_DB_PATH
  delete process.env.BRAIN_HOME
  resetLocalMessageToolsAvailabilityForTests()
  await rm(dir, { recursive: true, force: true })
})

describe('GET /api/imessage/thread', () => {
  it('returns compact messages for canonical chat query', async () => {
    const res = await app.request('/api/imessage/thread?chat=%2B15550001111')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      chat?: string
      canonical_chat?: string
      messages?: Array<{ sent_at_unix: number; is_from_me: boolean; text: string }>
      returned_count?: number
    }
    expect(body.ok).toBe(true)
    expect(body.canonical_chat).toBe('+15550001111')
    expect(body.messages?.map((m) => m.text)).toEqual(['Hello', 'Reply'])
  })

  it('GET /api/messages/thread is an alias for the same handler', async () => {
    const res = await app.request('/api/messages/thread?chat=%2B15550001111')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; canonical_chat?: string }
    expect(body.ok).toBe(true)
    expect(body.canonical_chat).toBe('+15550001111')
  })

  it('returns 400 when chat is missing', async () => {
    const res = await app.request('/api/imessage/thread')
    expect(res.status).toBe(400)
  })

  it('falls back to hosted message store when local messages are disabled', async () => {
    resetLocalMessageToolsAvailabilityForTests()
    process.env.IMESSAGE_DB_PATH = join(dir, 'missing-chat.db')
    initLocalMessageToolsAvailability()
    upsertImessageBatch('cloud-mac', [
      {
        guid: 'cloud-msg-1',
        rowid: 42,
        date_ms: Date.now(),
        text: 'from hosted index',
        is_from_me: false,
        handle: '+15550001111',
        chat_identifier: '+15550001111',
        display_name: 'Alice',
      },
    ])
    const { default: imessageRoute } = await import('./imessage.js')
    const app2 = new Hono()
    app2.route('/api/messages', imessageRoute)
    const res = await app2.request('/api/messages/thread?chat=%2B15550001111')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { hosted_source?: boolean; messages?: Array<{ text: string }> }
    expect(body.hosted_source).toBe(true)
    expect(body.messages?.map((m) => m.text)).toEqual(['from hosted index'])
  })
})
