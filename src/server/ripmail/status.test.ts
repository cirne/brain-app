/**
 * {@link statusParsed} dual sync lanes + Gmail deepening semantics (TS ripmail).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { openRipmailDb, closeRipmailDb } from './db.js'
import { statusParsed } from './status.js'
import {
  clearSyncSummaryRunning,
  markFirstBackfillCompleted,
  setBackfillListedTarget,
  setSyncSummaryRunning,
} from './sync/persist.js'

function insertOneMessage(db: ReturnType<typeof openRipmailDb>): void {
  const mid = `<t-${randomUUID()}>`
  db.prepare(`
    INSERT INTO messages (message_id, thread_id, folder, uid, from_address, from_name,
                          to_addresses, cc_addresses, to_recipients, cc_recipients,
                          subject, date, body_text, raw_path, source_id, is_archived)
    VALUES (?, ?, 'INBOX', 1, 'a@example.com', 'A',
            '["b@example.com"]', '[]', '[]', '[]',
            'Hi', '2026-01-15T10:00:00Z', 'body', '', 'gsrc', 0)
  `).run(mid, mid)
}

describe('statusParsed', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'rmstat-'))
    mkdirSync(join(home, 'x'), { recursive: true })
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'gsrc',
            kind: 'imap',
            email: 'a@gmail.com',
            imapAuth: 'googleOAuth',
            imap: { host: 'imap.gmail.com', port: 993, user: 'a@gmail.com' },
          },
        ],
      }),
    )
  })

  afterEach(() => {
    closeRipmailDb(home)
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('uses sync_summary id=1 for refreshRunning and id=2 for backfillRunning', () => {
    const db = openRipmailDb(home)
    setSyncSummaryRunning(db, 'backfill')
    let p = statusParsed(db, home)
    expect(p.backfillRunning).toBe(true)
    expect(p.refreshRunning).toBe(false)
    expect(p.syncRunning).toBe(true)
    clearSyncSummaryRunning(db)
    p = statusParsed(db, home)
    expect(p.syncRunning).toBe(false)
  })

  it('surfaces backfillListedTarget from sync_summary id=2 while historical lane runs', () => {
    const db = openRipmailDb(home)
    setSyncSummaryRunning(db, 'backfill')
    setBackfillListedTarget(db, 25885)
    const p = statusParsed(db, home)
    expect(p.backfillRunning).toBe(true)
    expect(p.backfillListedTarget).toBe(25885)
    clearSyncSummaryRunning(db)
    expect(statusParsed(db, home).backfillListedTarget).toBeNull()
  })

  it('pendingRefresh is false once messages exist while deepHistoricalPending stays true until 1y meta', () => {
    const db = openRipmailDb(home)
    let p = statusParsed(db, home)
    expect(p.pendingRefresh).toBe(true)
    expect(p.deepHistoricalPending).toBe(true)

    insertOneMessage(db)
    p = statusParsed(db, home)
    expect(p.pendingRefresh).toBe(false)
    expect(p.deepHistoricalPending).toBe(true)

    markFirstBackfillCompleted(db, 'gsrc')
    p = statusParsed(db, home)
    expect(p.deepHistoricalPending).toBe(false)
  })
})
