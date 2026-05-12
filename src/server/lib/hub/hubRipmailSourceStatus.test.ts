import { describe, expect, it } from 'vitest'
import { parseHubSourceMailStatusFromStdout } from './hubRipmailSourceStatus.js'

const minimalStatus = (mailboxes: unknown[]) =>
  JSON.stringify({
    sync: {
      staleLockInDb: false,
      refresh: {
        isRunning: false,
        lastSyncAt: '2026-04-18T12:00:00Z',
        totalMessages: 42,
        earliestSyncedDate: '2024-01-01',
        latestSyncedDate: '2026-04-17',
        targetStartDate: null,
        syncStartEarliestDate: null,
        lockHeldByLiveProcess: true,
        lockAgeMs: null,
        lockOwnerPid: null,
      },
      backfill: {
        isRunning: false,
        lastSyncAt: null,
        targetStartDate: null,
        syncStartEarliestDate: null,
        lockHeldByLiveProcess: true,
        lockAgeMs: null,
        lockOwnerPid: null,
      },
    },
    search: { indexedMessages: 100, ftsReady: 100 },
    freshness: {
      lastSyncAgo: { human: '1 day ago', duration: 'P1D' },
    },
    mailboxes,
  })

describe('parseHubSourceMailStatusFromStdout', () => {
  it('maps mailbox row by mailboxId', () => {
    const stdout = minimalStatus([
      {
        mailboxId: 'applemail_local',
        email: 'local@apple',
        messageCount: 240,
        lastUid: 99,
        needsBackfill: false,
        earliestDate: '2023-06-01T00:00:00Z',
        latestDate: '2026-04-10T15:30:00Z',
        latestMailAgo: { human: '5 days ago', duration: 'P5D' },
      },
    ])
    const r = parseHubSourceMailStatusFromStdout(stdout, 'applemail_local')
    expect(r).not.toBeNull()
    expect(r!.mailbox).toMatchObject({
      messageCount: 240,
      lastUid: 99,
      needsBackfill: false,
      newestIndexedAgo: '5 days ago',
    })
    expect(r!.mailbox!.earliestDate).toContain('2023-06-01')
    expect(r!.index.totalIndexed).toBe(100)
    expect(r!.index.lastSyncAgoHuman).toBe('1 day ago')
    expect(r!.index.lastSyncAt).toContain('2026-04-18')
    expect(r!.index.backfillListedTarget).toBeNull()
  })

  it('reports backfill live + listed target when nested backfill lane matches Rust shape', () => {
    const stdout = JSON.stringify({
      sync: {
        staleLockInDb: false,
        refresh: {
          isRunning: false,
          lastSyncAt: '2026-04-18T12:00:00Z',
          totalMessages: 400,
          lockHeldByLiveProcess: true,
          lockAgeMs: null,
        },
        backfill: {
          isRunning: true,
          lastSyncAt: null,
          totalMessages: 25885,
          lockHeldByLiveProcess: true,
          lockAgeMs: 5000,
        },
      },
      search: { indexedMessages: 472, ftsReady: 472 },
      mailboxes: [{ mailboxId: 'lewiscirne_gmail_com', messageCount: 472, needsBackfill: false }],
      freshness: {},
    })
    const r = parseHubSourceMailStatusFromStdout(stdout, 'lewiscirne_gmail_com')
    expect(r).not.toBeNull()
    expect(r!.index.backfillRunning).toBe(true)
    expect(r!.index.backfillListedTarget).toBe(25885)
    expect(r!.mailbox?.messageCount).toBe(472)
  })

  it('treats backfill as not running when lockHeldByLiveProcess is false (regression)', () => {
    const stdout = JSON.stringify({
      sync: {
        staleLockInDb: false,
        refresh: { isRunning: false, lockHeldByLiveProcess: true, totalMessages: 0 },
        backfill: {
          isRunning: true,
          totalMessages: 100,
          lockHeldByLiveProcess: false,
        },
      },
      search: { indexedMessages: 0 },
      mailboxes: [],
      freshness: {},
    })
    const r = parseHubSourceMailStatusFromStdout(stdout, 'x')
    expect(r).not.toBeNull()
    expect(r!.index.backfillRunning).toBe(false)
    expect(r!.index.backfillListedTarget).toBeNull()
  })

  it('returns null mailbox when id not in list', () => {
    const stdout = minimalStatus([
      { mailboxId: 'other', messageCount: 1, needsBackfill: false },
    ])
    const r = parseHubSourceMailStatusFromStdout(stdout, 'missing')
    expect(r).not.toBeNull()
    expect(r!.mailbox).toBeNull()
  })

  it('returns null on invalid JSON', () => {
    expect(parseHubSourceMailStatusFromStdout('not json', 'x')).toBeNull()
  })
})
