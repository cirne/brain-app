import { describe, it, expect } from 'vitest'
import {
  computeIndexingUserHint,
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
    expect(p!.syncLockAgeMs).toBeNull()
    expect(p!.ftsReady).toBe(0)
  })

  it('parses populated sync (indexed count prefers ftsReady over sync.totalMessages)', () => {
    const p = parseRipmailStatusJson(populatedFixture)
    expect(p!.indexedTotal).toBe(1)
    expect(p!.lastSyncedAt).toBe('2026-04-15T12:00:00.000Z')
    expect(p!.dateRange.from).toBe('2024-01-01')
    expect(p!.dateRange.to).toBe('2026-04-14')
    expect(p!.syncRunning).toBe(true)
    expect(p!.ftsReady).toBe(1)
  })

  it('parses Apple Mail interim backfill (uses ftsReady / mailboxes when totalMessages is 0)', () => {
    const p = parseRipmailStatusJson(appleMailInterimFixture)
    expect(p).not.toBeNull()
    expect(p!.indexedTotal).toBe(9030)
    expect(p!.syncRunning).toBe(true)
    expect(p!.syncLockAgeMs).toBeNull()
    expect(p!.ftsReady).toBe(9030)
  })

  it('uses indexedMessages when sync.totalMessages is inflated', () => {
    const p = parseRipmailStatusJson(inflatedSyncTotalFixture)
    expect(p!.indexedTotal).toBe(40135)
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
    expect(computeIndexingUserHint(p!)).toContain('stay at zero')
    expect(computeIndexingUserHint(p!, { mailProvider: 'google' })).toContain('first connection')
    expect(computeIndexingUserHint(p!, { mailProvider: 'google' })).not.toContain('Mail is scanned')
  })

  it('treats stale DB lock as not running', () => {
    const p = parseRipmailStatusJson(staleLockFixture)
    expect(p).not.toBeNull()
    expect(p!.syncRunning).toBe(false)
    expect(p!.staleLockInDb).toBe(true)
    expect(computeIndexingUserHint(p!)).toContain('Quit Braintunnel')
  })

  it('flags pending refresh when a mailbox needs backfill and sync is idle', () => {
    const p = parseRipmailStatusJson(needsBackfillIdleFixture)
    expect(p).not.toBeNull()
    expect(p!.pendingRefresh).toBe(true)
    expect(computeIndexingUserHint(p!)).toContain('starting')
  })

  it('returns null for invalid JSON', () => {
    expect(parseRipmailStatusJson('not json')).toBeNull()
  })

  it('returns null when sync missing', () => {
    expect(parseRipmailStatusJson('{"search":{}}')).toBeNull()
  })
})
