import { describe, it, expect } from 'vitest'
import {
  buildRipmailStatusLogSnapshot,
  computeIndexingActionHint,
  computeIndexingUserHint,
  listRipmailStatusAnomalies,
  parseRipmailStatusJson,
} from './ripmailStatusParse.js'

const emptyInstallFixture = `{
  "sync": {
    "isRunning": false,
    "lastSyncAt": null,
    "totalMessages": 0,
    "earliestSyncedDate": null,
    "latestSyncedDate": null,
    "targetStartDate": null,
    "syncStartEarliestDate": null,
    "lockHeldByLiveProcess": false,
    "lockAgeMs": null,
    "lockOwnerPid": null,
    "staleLockInDb": false,
    "initialSyncHangSuspected": false
  },
  "search": {
    "indexedMessages": 0,
    "ftsReady": 0
  },
  "freshness": {
    "lastSyncAgo": null
  },
  "mailboxes": []
}`

const populatedFixture = `{
  "sync": {
    "isRunning": true,
    "lastSyncAt": "2026-04-15T12:00:00.000Z",
    "totalMessages": 42,
    "earliestSyncedDate": "2024-01-01",
    "latestSyncedDate": "2026-04-14"
  },
  "search": {
    "indexedMessages": 1,
    "ftsReady": 1
  }
}`

/** `sync.totalMessages` can inflate; onboarding must use `search.indexedMessages` only. */
const inflatedSyncTotalFixture = `{
  "sync": {
    "isRunning": true,
    "lastSyncAt": "2026-04-16T12:00:00.000Z",
    "totalMessages": 253000,
    "earliestSyncedDate": "2025-04-16",
    "latestSyncedDate": "2026-04-16"
  },
  "search": { "indexedMessages": 40135, "ftsReady": 40135 },
  "mailboxes": [
    {
      "email": "applemail@local",
      "messageCount": 40135,
      "needsBackfill": false
    }
  ]
}`

const appleMailInterimFixture = `{
  "sync": {
    "isRunning": true,
    "lastSyncAt": null,
    "totalMessages": 0,
    "earliestSyncedDate": null,
    "latestSyncedDate": null
  },
  "search": { "indexedMessages": 9030, "ftsReady": 9030 },
  "mailboxes": [
    {
      "email": "applemail@local",
      "messageCount": 9030,
      "needsBackfill": false
    }
  ]
}`

/** DB says “running” but no live process — UI must not show “syncing”. */
const staleLockFixture = `{
  "sync": {
    "isRunning": true,
    "lastSyncAt": null,
    "totalMessages": 0,
    "staleLockInDb": true,
    "lockHeldByLiveProcess": false,
    "lockAgeMs": 1000
  },
  "search": { "indexedMessages": 0, "ftsReady": 0 },
  "mailboxes": []
}`

const needsBackfillIdleFixture = `{
  "sync": {
    "isRunning": false,
    "lastSyncAt": null,
    "totalMessages": 0,
    "staleLockInDb": false,
    "lockHeldByLiveProcess": false
  },
  "search": { "indexedMessages": 0, "ftsReady": 0 },
  "mailboxes": [
    { "email": "a@b.com", "messageCount": 0, "needsBackfill": true }
  ]
}`

describe('parseRipmailStatusJson', () => {
  it('parses empty install shape', () => {
    const p = parseRipmailStatusJson(emptyInstallFixture)
    expect(p).not.toBeNull()
    expect(p!.indexedTotal).toBe(0)
    expect(p!.lastSyncedAt).toBeNull()
    expect(p!.dateRange.from).toBeNull()
    expect(p!.dateRange.to).toBeNull()
    expect(p!.syncRunning).toBe(false)
    expect(p!.refreshRunning).toBe(false)
    expect(p!.backfillRunning).toBe(false)
    expect(p!.syncLockAgeMs).toBeNull()
    expect(p!.ftsReady).toBe(0)
    expect(p!.messageAvailableForProgress).toBeNull()
  })

  it('parses populated sync (indexed count prefers ftsReady over sync.totalMessages)', () => {
    const p = parseRipmailStatusJson(populatedFixture)
    expect(p!.indexedTotal).toBe(1)
    expect(p!.lastSyncedAt).toBe('2026-04-15T12:00:00.000Z')
    expect(p!.dateRange.from).toBe('2024-01-01')
    expect(p!.dateRange.to).toBe('2026-04-14')
    expect(p!.ftsReady).toBe(1)
    expect(p!.syncRunning).toBe(true)
    expect(p!.refreshRunning).toBe(true)
    expect(p!.backfillRunning).toBe(false)
    expect(p!.messageAvailableForProgress).toBe(42)
  })

  it('parses Apple Mail interim backfill (uses ftsReady / mailboxes when totalMessages is 0)', () => {
    const p = parseRipmailStatusJson(appleMailInterimFixture)
    expect(p).not.toBeNull()
    expect(p!.indexedTotal).toBe(9030)
    expect(p!.syncRunning).toBe(true)
    expect(p!.refreshRunning).toBe(true)
    expect(p!.backfillRunning).toBe(false)
    expect(p!.syncLockAgeMs).toBeNull()
    expect(p!.ftsReady).toBe(9030)
    expect(p!.messageAvailableForProgress).toBe(9030)
  })

  it('uses indexedMessages when sync.totalMessages is inflated', () => {
    const p = parseRipmailStatusJson(inflatedSyncTotalFixture)
    expect(p!.indexedTotal).toBe(40135)
    expect(p!.messageAvailableForProgress).toBe(40135)
  })

  it('prefers search.indexedMessages over ftsReady when both are present', () => {
    const raw = `{
      "sync": {
        "isRunning": false,
        "lastSyncAt": null,
        "totalMessages": 100,
        "staleLockInDb": false,
        "lockHeldByLiveProcess": false
      },
      "search": { "indexedMessages": 7, "ftsReady": 99 },
      "mailboxes": []
    }`
    const p = parseRipmailStatusJson(raw)
    expect(p!.indexedTotal).toBe(7)
    expect(p!.ftsReady).toBe(7)
    expect(p!.messageAvailableForProgress).toBe(100)
  })

  it('legacy JSON without indexedMessages still parses via ftsReady', () => {
    const raw = `{
      "sync": {
        "isRunning": false,
        "lastSyncAt": null,
        "totalMessages": 99999,
        "staleLockInDb": false,
        "lockHeldByLiveProcess": false
      },
      "search": { "ftsReady": 12 },
      "mailboxes": []
    }`
    const p = parseRipmailStatusJson(raw)
    expect(p!.indexedTotal).toBe(12)
  })

  it('parses sync.lockAgeMs for onboarding progress', () => {
    const raw = `{
      "sync": {
        "isRunning": true,
        "lastSyncAt": null,
        "totalMessages": 0,
        "lockHeldByLiveProcess": true,
        "lockAgeMs": 125000,
        "staleLockInDb": false
      },
      "search": { "indexedMessages": 0, "ftsReady": 0 },
      "mailboxes": [{ "email": "a@b.com", "messageCount": 0, "needsBackfill": false }]
    }`
    const p = parseRipmailStatusJson(raw)
    expect(p).not.toBeNull()
    expect(p!.syncLockAgeMs).toBe(125000)
    expect(p!.syncRunning).toBe(true)
    expect(p!.refreshRunning).toBe(true)
    expect(p!.backfillRunning).toBe(false)
    expect(computeIndexingActionHint(p!)).toBeNull()
    expect(computeIndexingUserHint(p!)).toContain('stay at zero')
    expect(computeIndexingUserHint(p!, { mailProvider: 'google' })).toContain('first connection')
    expect(computeIndexingUserHint(p!, { mailProvider: 'google' })).not.toContain('Mail is scanned')
  })

  it('treats stale DB lock as not running', () => {
    const p = parseRipmailStatusJson(staleLockFixture)
    expect(p).not.toBeNull()
    expect(p!.syncRunning).toBe(false)
    expect(p!.refreshRunning).toBe(false)
    expect(p!.backfillRunning).toBe(false)
    expect(p!.staleLockInDb).toBe(true)
    expect(computeIndexingActionHint(p!)).toBe('A previous mail sync stopped unexpectedly.')
    expect(computeIndexingUserHint(p!)).toContain('Refresh the page')
  })

  it('flags pending refresh when a mailbox needs backfill and sync is idle', () => {
    const p = parseRipmailStatusJson(needsBackfillIdleFixture)
    expect(p).not.toBeNull()
    expect(p!.pendingRefresh).toBe(true)
    expect(p!.refreshRunning).toBe(false)
    expect(p!.backfillRunning).toBe(false)
    expect(computeIndexingActionHint(p!)).toBeNull()
    expect(computeIndexingUserHint(p!)).toContain('starting')
  })

  it('parses nested sync.refresh idle and sync.backfill running', () => {
    const raw = `{
      "sync": {
        "staleLockInDb": false,
        "initialSyncHangSuspected": false,
        "refresh": {
          "isRunning": false,
          "lockHeldByLiveProcess": false,
          "lastSyncAt": "2026-04-01T00:00:00.000Z"
        },
        "backfill": {
          "isRunning": true,
          "lockHeldByLiveProcess": true,
          "lockAgeMs": 8000,
          "lastSyncAt": null
        }
      },
      "search": { "indexedMessages": 250, "ftsReady": 250 },
      "mailboxes": []
    }`
    const p = parseRipmailStatusJson(raw)
    expect(p).not.toBeNull()
    expect(p!.indexedTotal).toBe(250)
    expect(p!.refreshRunning).toBe(false)
    expect(p!.backfillRunning).toBe(true)
    expect(p!.syncRunning).toBe(true)
    expect(p!.syncLockAgeMs).toBe(8000)
  })

  it('returns null for invalid JSON', () => {
    expect(parseRipmailStatusJson('not json')).toBeNull()
  })

  it('returns null when sync missing', () => {
    expect(parseRipmailStatusJson('{"search":{}}')).toBeNull()
  })
})

describe('listRipmailStatusAnomalies', () => {
  it('is empty for normal fixtures', () => {
    expect(listRipmailStatusAnomalies(parseRipmailStatusJson(emptyInstallFixture)!)).toEqual([])
    expect(listRipmailStatusAnomalies(parseRipmailStatusJson(populatedFixture)!)).toEqual([])
    expect(listRipmailStatusAnomalies(parseRipmailStatusJson(staleLockFixture)!)).toEqual([])
  })

  it('flags hang suspected when no lane is considered live', () => {
    const raw = `{
      "sync": {
        "isRunning": false,
        "initialSyncHangSuspected": true,
        "lockHeldByLiveProcess": false,
        "staleLockInDb": false,
        "lockAgeMs": null
      },
      "search": { "indexedMessages": 0 },
      "mailboxes": []
    }`
    const p = parseRipmailStatusJson(raw)!
    expect(p.syncRunning).toBe(false)
    expect(listRipmailStatusAnomalies(p)).toContain('hang_suspected_without_live_sync')
  })

  it('flags negative lock age', () => {
    const raw = `{
      "sync": {
        "isRunning": true,
        "lockHeldByLiveProcess": true,
        "staleLockInDb": false,
        "lockAgeMs": -1
      },
      "search": { "indexedMessages": 0 },
      "mailboxes": []
    }`
    expect(listRipmailStatusAnomalies(parseRipmailStatusJson(raw)!)).toContain('negative_lock_age_ms')
  })

  it('flags very long lock age while running', () => {
    const age = 2 * 60 * 60 * 1000
    const raw = `{
      "sync": {
        "isRunning": true,
        "lockHeldByLiveProcess": true,
        "staleLockInDb": false,
        "lockAgeMs": ${age}
      },
      "search": { "indexedMessages": 0 },
      "mailboxes": []
    }`
    expect(listRipmailStatusAnomalies(parseRipmailStatusJson(raw)!)).toContain(
      'lock_age_exceeds_1h_while_running',
    )
  })
})

describe('buildRipmailStatusLogSnapshot', () => {
  it('returns ok snapshot for populated fixture', () => {
    const populatedFixture = `{
  "sync": {
    "isRunning": true,
    "lastSyncAt": "2026-04-15T12:00:00.000Z",
    "totalMessages": 42,
    "earliestSyncedDate": "2024-01-01",
    "latestSyncedDate": "2026-04-14"
  },
  "search": {
    "indexedMessages": 1,
    "ftsReady": 1
  }
}`
    const s = buildRipmailStatusLogSnapshot(populatedFixture)
    expect(s.statusParse).toBe('ok')
    if (s.statusParse !== 'ok') return
    expect(s.syncRunning).toBe(true)
    expect(s.refreshRunning).toBe(true)
    expect(s.backfillRunning).toBe(false)
    expect(s.indexed).toBe(1)
    expect(s.lastSyncAt).toBe('2026-04-15T12:00:00.000Z')
  })

  it('returns failed for invalid input', () => {
    expect(buildRipmailStatusLogSnapshot('not json')).toEqual({ statusParse: 'failed' })
  })
})
