import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { upsertLinkedMailbox } from '@server/lib/tenant/linkedMailboxes.js'
import { brainLayoutRipmailDir } from '@server/lib/platform/brainLayout.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { syncMailNotifyNotificationsFromRipmailDb } from './syncMailNotifyNotifications.js'
import { listNotifications } from './notificationsRepo.js'
import { mailNotifyIdempotencyKey } from './mailNotifyIdempotency.js'

const RIPMAIL_NOTIFY_TEST_DDL = `
CREATE TABLE messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT ''
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
`

function seedMinimalRipmailDb(dbPath: string): void {
  const db = new Database(dbPath)
  db.exec(RIPMAIL_NOTIFY_TEST_DDL)
  db.prepare(`INSERT INTO messages (message_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)`).run(
    'msg-notify-1',
    'thr-a',
    'Hello notify',
    '',
  )
  db.prepare(
    `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at)
     VALUES (?, 'fp1', 'notify', 'test', '2026-01-02T00:00:00Z')`,
  ).run('msg-notify-1')
  db.prepare(`INSERT INTO messages (message_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)`).run(
    'msg-inform-1',
    'thr-b',
    'Inform only',
    '',
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
    db.exec(RIPMAIL_NOTIFY_TEST_DDL)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)`).run(
      'inform-only',
      'thr',
      'Inform subject',
      '',
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
    db.exec(RIPMAIL_NOTIFY_TEST_DDL)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)`).run(
      'msg-ar',
      'thr',
      'Todo mail',
      '',
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
    db.exec(RIPMAIL_NOTIFY_TEST_DDL)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)`).run(
      'inf-ar',
      't',
      'FYI plus todo',
      '',
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
    db.exec(RIPMAIL_NOTIFY_TEST_DDL)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)`).run(
      'msg-merge',
      'thr',
      'Subject',
      '',
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

describe('syncMailNotifyNotificationsFromRipmailDb brain_query_mail enrichment', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let root: string
  const ownerId = 'usr_50505050505050505050'
  const askerId = 'usr_60606060606060606060'
  const otherAskerId = 'usr_70707070707070707070'

  function writeNotifyRipmailDb(params: {
    dbPath: string
    messageId: string
    threadId: string
    subject: string
    fromAddress: string
  }): void {
    const db = new Database(params.dbPath)
    db.exec(RIPMAIL_NOTIFY_TEST_DDL)
    db.prepare(`INSERT INTO messages (message_id, thread_id, subject, from_address) VALUES (?, ?, ?, ?)`).run(
      params.messageId,
      params.threadId,
      params.subject,
      params.fromAddress,
    )
    db.prepare(
      `INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source, decided_at)
       VALUES (?, 'fp1', 'notify', 'test', '2026-01-02T00:00:00Z')`,
    ).run(params.messageId)
    db.close()
  }

  beforeEach(async () => {
    closeTenantDbForTests()
    delete process.env.BRAIN_HOME
    root = await mkdtemp(join(tmpdir(), 'bq-mail-sync-'))
    process.env.BRAIN_DATA_ROOT = root
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(root, '.global', 'brain-global.sqlite')
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    closeTenantDbForTests()
    delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    delete process.env.BRAIN_DATA_ROOT
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    await rm(root, { recursive: true, force: true })
  })

  it('uses brain_query_mail when subject marker matches grant and sender', async () => {
    ensureTenantHomeDir(ownerId)
    ensureTenantHomeDir(askerId)
    await writeHandleMeta(tenantHomeDir(askerId), {
      userId: askerId,
      handle: 'pat',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'pat', homeDir: tenantHomeDir(askerId) },
      async () =>
        upsertLinkedMailbox({
          email: 'collab@test.dev',
          googleSub: 'sub-collab',
          isPrimary: true,
          nowIso: '2026-01-01T00:00:00.000Z',
        }),
    )
    createBrainQueryGrant({ ownerId, askerId, presetPolicyKey: 'general' })

    const ownerHome = tenantHomeDir(ownerId)
    process.env.BRAIN_HOME = ownerHome
    const ripDir = brainLayoutRipmailDir(ownerHome)
    await mkdir(ripDir, { recursive: true })
    writeNotifyRipmailDb({
      dbPath: join(ripDir, 'ripmail.db'),
      messageId: 'msg-bq-1',
      threadId: 'thr-bq',
      subject: '[braintunnel] Quick question',
      fromAddress: 'Pat <collab@test.dev>',
    })

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner', homeDir: ownerHome },
      async () => {
        await syncMailNotifyNotificationsFromRipmailDb()
        const list = listNotifications({})
        expect(list).toHaveLength(1)
        expect(list[0].sourceKind).toBe('brain_query_mail')
        const p = list[0].payload as Record<string, unknown>
        expect(p.messageId).toBe('msg-bq-1')
        expect(p.grantId).toMatch(/^bqg_/)
        expect(p.peerUserId).toBe(askerId)
        expect(p.peerPrimaryEmail).toBe('collab@test.dev')
        expect(p.peerHandle).toBe('pat')
      },
    )
  })

  it('keeps mail_notify when subject has marker but there is no grant for the sender', async () => {
    ensureTenantHomeDir(ownerId)
    ensureTenantHomeDir(askerId)
    ensureTenantHomeDir(otherAskerId)
    await writeHandleMeta(tenantHomeDir(askerId), {
      userId: askerId,
      handle: 'pat',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'pat', homeDir: tenantHomeDir(askerId) },
      async () =>
        upsertLinkedMailbox({
          email: 'collab@test.dev',
          googleSub: 'sub-collab',
          isPrimary: true,
          nowIso: '2026-01-01T00:00:00.000Z',
        }),
    )
    createBrainQueryGrant({ ownerId, askerId: otherAskerId, presetPolicyKey: 'general' })

    const ownerHome = tenantHomeDir(ownerId)
    process.env.BRAIN_HOME = ownerHome
    const ripDir = brainLayoutRipmailDir(ownerHome)
    await mkdir(ripDir, { recursive: true })
    writeNotifyRipmailDb({
      dbPath: join(ripDir, 'ripmail.db'),
      messageId: 'msg-bq-2',
      threadId: 'thr-bq',
      subject: '[braintunnel] Quick question',
      fromAddress: 'collab@test.dev',
    })

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner', homeDir: ownerHome },
      async () => {
        await syncMailNotifyNotificationsFromRipmailDb()
        const list = listNotifications({})
        expect(list).toHaveLength(1)
        expect(list[0].sourceKind).toBe('mail_notify')
      },
    )
  })

  it('keeps mail_notify when subject lacks the braintunnel marker even if grant exists', async () => {
    ensureTenantHomeDir(ownerId)
    ensureTenantHomeDir(askerId)
    await writeHandleMeta(tenantHomeDir(askerId), {
      userId: askerId,
      handle: 'pat',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'pat', homeDir: tenantHomeDir(askerId) },
      async () =>
        upsertLinkedMailbox({
          email: 'collab@test.dev',
          googleSub: 'sub-collab',
          isPrimary: true,
          nowIso: '2026-01-01T00:00:00.000Z',
        }),
    )
    createBrainQueryGrant({ ownerId, askerId, presetPolicyKey: 'general' })

    const ownerHome = tenantHomeDir(ownerId)
    process.env.BRAIN_HOME = ownerHome
    const ripDir = brainLayoutRipmailDir(ownerHome)
    await mkdir(ripDir, { recursive: true })
    writeNotifyRipmailDb({
      dbPath: join(ripDir, 'ripmail.db'),
      messageId: 'msg-bq-3',
      threadId: 'thr-bq',
      subject: 'Plain subject',
      fromAddress: 'collab@test.dev',
    })

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner', homeDir: ownerHome },
      async () => {
        await syncMailNotifyNotificationsFromRipmailDb()
        const list = listNotifications({})
        expect(list).toHaveLength(1)
        expect(list[0].sourceKind).toBe('mail_notify')
      },
    )
  })

  it('upgrades mail_notify to brain_query_mail on a later sync once tenant context can enrich', async () => {
    ensureTenantHomeDir(ownerId)
    ensureTenantHomeDir(askerId)
    await writeHandleMeta(tenantHomeDir(askerId), {
      userId: askerId,
      handle: 'pat',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'pat', homeDir: tenantHomeDir(askerId) },
      async () =>
        upsertLinkedMailbox({
          email: 'collab@test.dev',
          googleSub: 'sub-collab',
          isPrimary: true,
          nowIso: '2026-01-01T00:00:00.000Z',
        }),
    )
    createBrainQueryGrant({ ownerId, askerId, presetPolicyKey: 'general' })

    const ownerHome = tenantHomeDir(ownerId)
    process.env.BRAIN_HOME = ownerHome
    const ripDir = brainLayoutRipmailDir(ownerHome)
    await mkdir(ripDir, { recursive: true })
    writeNotifyRipmailDb({
      dbPath: join(ripDir, 'ripmail.db'),
      messageId: 'msg-bq-4',
      threadId: 'thr-bq',
      subject: '[braintunnel] Later enrich',
      fromAddress: 'collab@test.dev',
    })

    await syncMailNotifyNotificationsFromRipmailDb()
    expect(listNotifications({})[0]?.sourceKind).toBe('mail_notify')

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner', homeDir: ownerHome },
      async () => {
        await syncMailNotifyNotificationsFromRipmailDb()
        expect(listNotifications({})[0]?.sourceKind).toBe('brain_query_mail')
      },
    )
  })
})
