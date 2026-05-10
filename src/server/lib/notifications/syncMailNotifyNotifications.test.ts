import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { syncMailNotifyNotificationsFromRipmailDb } from './syncMailNotifyNotifications.js'
import { listNotifications } from './notificationsRepo.js'
import { mailNotifyIdempotencyKey } from './mailNotifyIdempotency.js'

function seedMinimalRipmailDb(dbPath: string): void {
  const db = new Database(dbPath)
  db.exec(`
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT ''
);
CREATE TABLE inbox_decisions (
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  rules_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  matched_rule_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  decision_source TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  requires_user_action INTEGER NOT NULL DEFAULT 0,
  action_summary TEXT,
  PRIMARY KEY (message_id, rules_fingerprint)
);
`)
  db.prepare(`INSERT INTO messages (message_id, thread_id, subject) VALUES (?, ?, ?)`).run(
    'msg-notify-1',
    'thr-a',
    'Hello notify',
  )
  db.prepare(
    `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at)
     VALUES (?, 'fp1', 'notify', 'test', '2026-01-02T00:00:00Z')`,
  ).run('msg-notify-1')
  db.prepare(`INSERT INTO messages (message_id, thread_id, subject) VALUES (?, ?, ?)`).run(
    'msg-inform-1',
    'thr-b',
    'Inform only',
  )
  db.prepare(
    `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at)
     VALUES (?, 'fp1', 'inform', 'test', '2026-01-02T00:00:00Z')`,
  ).run('msg-inform-1')
  db.close()
}

describe('syncMailNotifyNotificationsFromRipmailDb', () => {
  beforeEach(() => {
    closeTenantDbForTests()
  })

  afterEach(async () => {
    closeTenantDbForTests()
    delete process.env.BRAIN_HOME
  })

  it('inserts one notification per notify message_id and dedupes via idempotency key', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mail-notify-sync-'))
    process.env.BRAIN_HOME = home
    const ripRoot = join(home, 'ripmail')
    await mkdir(ripRoot, { recursive: true })
    const dbPath = join(ripRoot, 'ripmail.db')
    seedMinimalRipmailDb(dbPath)

    await syncMailNotifyNotificationsFromRipmailDb()
    const list = listNotifications({})
    expect(list).toHaveLength(1)
    expect(list[0].sourceKind).toBe('mail_notify')
    expect(list[0].idempotencyKey).toBe(mailNotifyIdempotencyKey('msg-notify-1'))
    expect(list[0].payload).toEqual(
      expect.objectContaining({
        messageId: 'msg-notify-1',
        threadId: 'thr-a',
        subject: 'Hello notify',
        attention: { notify: true, actionRequired: false },
      }),
    )
    expect(
      list.some(
        (n) =>
          typeof n.payload === 'object' &&
          n.payload !== null &&
          (n.payload as { messageId?: string }).messageId === 'msg-inform-1',
      ),
    ).toBe(false)

    await syncMailNotifyNotificationsFromRipmailDb()
    expect(listNotifications({})).toHaveLength(1)

    await rm(home, { recursive: true, force: true })
  })

  it('does not mirror inform-only messages without action required', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mail-inform-only-'))
    process.env.BRAIN_HOME = home
    const ripRoot = join(home, 'ripmail')
    await mkdir(ripRoot, { recursive: true })
    const dbPath = join(ripRoot, 'ripmail.db')
    const db = new Database(dbPath)
    db.exec(`
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT ''
);
CREATE TABLE inbox_decisions (
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  rules_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  matched_rule_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  decision_source TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  requires_user_action INTEGER NOT NULL DEFAULT 0,
  action_summary TEXT,
  PRIMARY KEY (message_id, rules_fingerprint)
);
`)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject) VALUES (?, ?, ?)`).run(
      'inform-only',
      'thr',
      'Inform subject',
    )
    db.prepare(
      `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at)
       VALUES (?, 'fp1', 'inform', 'test', '2026-01-02T00:00:00Z')`,
    ).run('inform-only')
    db.close()

    const r = await syncMailNotifyNotificationsFromRipmailDb()
    expect(r.candidateCount).toBe(0)
    expect(listNotifications({})).toHaveLength(0)

    await rm(home, { recursive: true, force: true })
  })

  it('mirrors ignore disposition when requires_user_action', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mail-act-ignore-'))
    process.env.BRAIN_HOME = home
    const ripRoot = join(home, 'ripmail')
    await mkdir(ripRoot, { recursive: true })
    const dbPath = join(ripRoot, 'ripmail.db')
    const db = new Database(dbPath)
    db.exec(`
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT ''
);
CREATE TABLE inbox_decisions (
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  rules_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  matched_rule_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  decision_source TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  requires_user_action INTEGER NOT NULL DEFAULT 0,
  action_summary TEXT,
  PRIMARY KEY (message_id, rules_fingerprint)
);
`)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject) VALUES (?, ?, ?)`).run(
      'msg-ar',
      'thr',
      'Todo mail',
    )
    db.prepare(
      `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at, requires_user_action, action_summary)
       VALUES (?, 'fp1', 'ignore', 'test', '2026-01-02T00:00:00Z', 1, 'Reply to Alice')`,
    ).run('msg-ar')
    db.close()

    await syncMailNotifyNotificationsFromRipmailDb()
    const list = listNotifications({})
    expect(list).toHaveLength(1)
    const p = list[0].payload as Record<string, unknown>
    expect(p.attention).toEqual({ notify: false, actionRequired: true })
    expect(p.actionSummary).toBe('Reply to Alice')

    await rm(home, { recursive: true, force: true })
  })

  it('mirrors inform disposition when requires_user_action', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mail-act-inform-'))
    process.env.BRAIN_HOME = home
    const ripRoot = join(home, 'ripmail')
    await mkdir(ripRoot, { recursive: true })
    const dbPath = join(ripRoot, 'ripmail.db')
    const db = new Database(dbPath)
    db.exec(`
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT ''
);
CREATE TABLE inbox_decisions (
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  rules_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  matched_rule_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  decision_source TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  requires_user_action INTEGER NOT NULL DEFAULT 0,
  action_summary TEXT,
  PRIMARY KEY (message_id, rules_fingerprint)
);
`)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject) VALUES (?, ?, ?)`).run(
      'inf-ar',
      't',
      'FYI plus todo',
    )
    db.prepare(
      `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at, requires_user_action)
       VALUES (?, 'fp1', 'inform', 'test', '2026-01-03T00:00:00Z', 1)`,
    ).run('inf-ar')
    db.close()

    await syncMailNotifyNotificationsFromRipmailDb()
    expect(listNotifications({})).toHaveLength(1)
    const p = listNotifications({})[0].payload as { attention?: { notify?: boolean; actionRequired?: boolean } }
    expect(p.attention).toEqual({ notify: false, actionRequired: true })

    await rm(home, { recursive: true, force: true })
  })

  it('updates payload when action-required appears after notify-only sync', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mail-merge-'))
    process.env.BRAIN_HOME = home
    const ripRoot = join(home, 'ripmail')
    await mkdir(ripRoot, { recursive: true })
    const dbPath = join(ripRoot, 'ripmail.db')
    const db = new Database(dbPath)
    db.exec(`
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT ''
);
CREATE TABLE inbox_decisions (
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  rules_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  matched_rule_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  decision_source TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  requires_user_action INTEGER NOT NULL DEFAULT 0,
  action_summary TEXT,
  PRIMARY KEY (message_id, rules_fingerprint)
);
`)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject) VALUES (?, ?, ?)`).run(
      'msg-merge',
      'thr',
      'Subject',
    )
    db.prepare(
      `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at, requires_user_action)
       VALUES (?, 'fp1', 'notify', 'test', '2026-01-02T00:00:00Z', 0)`,
    ).run('msg-merge')
    db.close()

    await syncMailNotifyNotificationsFromRipmailDb()
    let list = listNotifications({})
    expect(list).toHaveLength(1)
    expect((list[0].payload as { attention?: unknown }).attention).toEqual({
      notify: true,
      actionRequired: false,
    })

    const db2 = new Database(dbPath)
    db2
      .prepare(`UPDATE inbox_decisions SET requires_user_action = 1, action_summary = ? WHERE message_id = ?`)
      .run('Please reply', 'msg-merge')
    db2.close()

    await syncMailNotifyNotificationsFromRipmailDb()
    list = listNotifications({})
    expect(list).toHaveLength(1)
    expect((list[0].payload as { attention?: unknown; actionSummary?: string }).attention).toEqual({
      notify: true,
      actionRequired: true,
    })
    expect((list[0].payload as { actionSummary?: string }).actionSummary).toBe('Please reply')

    await rm(home, { recursive: true, force: true })
  })

  it('returns candidateCount 0 when ripmail db is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mail-notify-no-db-'))
    process.env.BRAIN_HOME = home
    await mkdir(join(home, 'ripmail'), { recursive: true })
    const r = await syncMailNotifyNotificationsFromRipmailDb()
    expect(r.ripmailDbFound).toBe(false)
    expect(r.candidateCount).toBe(0)
    await rm(home, { recursive: true, force: true })
  })
})
