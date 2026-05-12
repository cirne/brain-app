import { existsSync } from 'node:fs'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { ripmailStatusParsed, ripmailDbPath } from '@server/ripmail/index.js'
import { parseRipmailStatusJson } from '@server/lib/ripmail/ripmailStatusParse.js'

export type HubSourceMailStatusOk = {
  ok: true
  sourceId: string
  /** Per-source row from `mailboxes[]`; null if id not found in status output. */
  mailbox: {
    messageCount: number
    earliestDate: string | null
    latestDate: string | null
    /** From `latestMailAgo.human` — recency of newest indexed message. */
    newestIndexedAgo: string | null
    needsBackfill: boolean
    lastUid: number | null
  } | null
  /** Whole-index fields (same shape as Rust `status --json`; live data comes from `ripmailStatusParsed`). */
  index: {
    totalIndexed: number | null
    syncRunning: boolean
    staleLockInDb: boolean
    refreshRunning: boolean
    backfillRunning: boolean
    /** Gmail historical lane: `messages.list` total for the in-flight backfill; null when unknown. */
    backfillListedTarget: number | null
    lastSyncAt: string | null
    /** From `freshness.lastSyncAgo.human` when present. */
    lastSyncAgoHuman: string | null
  }
}

export type HubSourceMailStatusPayload = HubSourceMailStatusOk | { ok: false; sourceId: string; error: string }

function readNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  return null
}

/** Match `parseRipmailStatusJson`: missing/`true` → live; only explicit `false` is not live. */
function lockHeldByLiveProcess(lane: Record<string, unknown>): boolean {
  return lane.lockHeldByLiveProcess !== false
}

function findMailboxRow(mailboxes: unknown, sourceId: string): Record<string, unknown> | null {
  if (!Array.isArray(mailboxes)) return null
  for (const row of mailboxes) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const mid = typeof r.mailboxId === 'string' ? r.mailboxId : ''
    if (mid === sourceId) return r
  }
  return null
}

function laneRunning(
  sync: Record<string, unknown>,
  laneKey: 'refresh' | 'backfill',
  staleLockInDb: boolean,
): boolean {
  const lane = sync[laneKey] as Record<string, unknown> | undefined
  if (!lane || typeof lane !== 'object') return false
  return lane.isRunning === true && lockHeldByLiveProcess(lane) && !staleLockInDb
}

function readLastSyncAgoHuman(root: Record<string, unknown>): string | null {
  const freshness = root.freshness as Record<string, unknown> | undefined
  const ago = freshness?.lastSyncAgo as Record<string, unknown> | undefined
  const human = ago?.human
  return typeof human === 'string' && human.trim() ? human.trim() : null
}

/**
 * Extract Hub source inspect fields from CLI-shaped status JSON (tests/fixtures),
 * or from {@link getHubSourceMailStatus} which synthesizes that shape from `ripmailStatusParsed`.
 */
export function parseHubSourceMailStatusFromStdout(
  stdout: string,
  sourceId: string,
): HubSourceMailStatusOk | null {
  let root: Record<string, unknown>
  try {
    root = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    return null
  }

  const parsed = parseRipmailStatusJson(stdout)
  if (!parsed) return null

  const sync = root.sync as Record<string, unknown> | undefined
  if (!sync || typeof sync !== 'object') return null

  const staleLockInDb = sync.staleLockInDb === true
  const refreshRunning = laneRunning(sync, 'refresh', staleLockInDb)
  const backfillRunning = laneRunning(sync, 'backfill', staleLockInDb)

  const search = root.search as Record<string, unknown> | undefined
  const totalIndexed = search && typeof search === 'object' ? readNum(search.indexedMessages) : null

  const row = findMailboxRow(root.mailboxes, sourceId)
  let mailbox: HubSourceMailStatusOk['mailbox'] = null
  if (row) {
    const latestAgo = row.latestMailAgo as Record<string, unknown> | undefined
    const newestHuman =
      latestAgo && typeof latestAgo === 'object' && typeof latestAgo.human === 'string'
        ? latestAgo.human.trim() || null
        : null
    mailbox = {
      messageCount: readNum(row.messageCount) ?? 0,
      earliestDate: readStr(row.earliestDate),
      latestDate: readStr(row.latestDate),
      newestIndexedAgo: newestHuman,
      needsBackfill: row.needsBackfill === true,
      lastUid: readNum(row.lastUid),
    }
  }

  return {
    ok: true,
    sourceId,
    mailbox,
    index: {
      totalIndexed,
      syncRunning: parsed.syncRunning,
      staleLockInDb: parsed.staleLockInDb,
      refreshRunning,
      backfillRunning,
      backfillListedTarget: parsed.backfillListedTarget,
      lastSyncAt: parsed.lastSyncedAt,
      lastSyncAgoHuman: readLastSyncAgoHuman(root),
    },
  }
}

export async function getHubSourceMailStatus(sourceId: string): Promise<HubSourceMailStatusPayload> {
  const id = sourceId?.trim()
  if (!id) {
    return { ok: false, sourceId: '', error: 'Source id required' }
  }
  const home = ripmailHomeForBrain()
  if (!existsSync(ripmailDbPath(home))) {
    return { ok: false, sourceId: id, error: 'ripmail DB not found' }
  }
  try {
    const parsed = await ripmailStatusParsed(home)
    // Minimal CLI-shaped JSON so tests + parseHubSourceMailStatusFromStdout stay aligned with Rust output.
    const stdout = JSON.stringify({
      sync: {
        refresh: {
          isRunning: parsed.refreshRunning,
          lastSyncAt: parsed.lastSyncedAt,
          totalMessages: parsed.messageAvailableForProgress ?? 0,
          earliestSyncedDate: parsed.dateRange.from,
          latestSyncedDate: parsed.dateRange.to,
          lockAgeMs: parsed.syncLockAgeMs,
          lockHeldByLiveProcess: parsed.refreshRunning,
        },
        backfill: {
          isRunning: parsed.backfillRunning,
          lastSyncAt: parsed.lastSyncedAt,
          totalMessages: parsed.backfillListedTarget ?? 0,
          lockAgeMs: parsed.syncLockAgeMs,
          lockHeldByLiveProcess: parsed.backfillRunning,
        },
        staleLockInDb: parsed.staleLockInDb,
      },
      search: {
        indexedMessages: parsed.indexedTotal ?? 0,
        ftsReady: parsed.ftsReady ?? 0,
      },
      mailboxes: [{ mailboxId: id, messageCount: parsed.indexedTotal ?? 0 }],
      freshness: {},
    })
    const result = parseHubSourceMailStatusFromStdout(stdout, id)
    if (!result) {
      return { ok: false, sourceId: id, error: 'Could not build mail status' }
    }
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, sourceId: id, error: msg }
  }
}
