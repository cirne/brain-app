import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
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
  /** Whole-index fields from the same `ripmail status --json` payload. */
  index: {
    totalIndexed: number | null
    syncRunning: boolean
    staleLockInDb: boolean
    refreshRunning: boolean
    backfillRunning: boolean
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
 * Extract Hub source inspect fields from `ripmail status --json` stdout.
 * Exported for unit tests.
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
  try {
    const { stdout } = await execRipmailAsync(`${ripmailBin()} status --json`, { timeout: 12_000 })
    const parsed = parseHubSourceMailStatusFromStdout(stdout, id)
    if (!parsed) {
      return { ok: false, sourceId: id, error: 'Could not parse ripmail status' }
    }
    return parsed
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, sourceId: id, error: msg }
  }
}
