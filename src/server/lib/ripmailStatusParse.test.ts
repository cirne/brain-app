import { describe, it, expect } from 'vitest'
import { parseRipmailStatusJson } from './ripmailStatusParse.js'

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
    "ftsReady": 1
  }
}`

/** Apple Mail: `totalMessages` stays 0 until done; `mailboxes` / `ftsReady` update during backfill. */
const appleMailInterimFixture = `{
  "sync": {
    "isRunning": true,
    "lastSyncAt": null,
    "totalMessages": 0,
    "earliestSyncedDate": null,
    "latestSyncedDate": null
  },
  "search": { "ftsReady": 9030 },
  "mailboxes": [
    {
      "email": "applemail@local",
      "messageCount": 9030,
      "needsBackfill": false
    }
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
    expect(p!.ftsReady).toBe(0)
  })

  it('parses populated sync', () => {
    const p = parseRipmailStatusJson(populatedFixture)
    expect(p!.indexedTotal).toBe(42)
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
    expect(p!.ftsReady).toBe(9030)
  })

  it('returns null for invalid JSON', () => {
    expect(parseRipmailStatusJson('not json')).toBeNull()
  })

  it('returns null when sync missing', () => {
    expect(parseRipmailStatusJson('{"search":{}}')).toBeNull()
  })
})
