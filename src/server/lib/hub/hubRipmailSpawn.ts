import { formatExecError } from '@server/lib/platform/execError.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { refresh as ripmailRefresh } from '@server/ripmail/sync/index.js'

export interface HubRipmailSpawnResult {
  ok: boolean
  error?: string
}

/** Allowed `ripmail backfill --since` values from Brain Hub (matches hub UI dropdown). */
export const HUB_BACKFILL_SINCE_OPTIONS = ['30d', '90d', '180d', '1y', '2y'] as const

export function isValidHubBackfillSince(spec: string): boolean {
  const s = spec.trim().toLowerCase()
  return (HUB_BACKFILL_SINCE_OPTIONS as readonly string[]).includes(s)
}

/** Incremental sync for one mailbox. */
export async function spawnRipmailRefreshSource(sourceId: string): Promise<HubRipmailSpawnResult> {
  const id = sourceId.trim()
  if (!id) return { ok: false, error: 'source id required' }
  try {
    await ripmailRefresh(ripmailHomeForBrain(), { sourceId: id })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: formatExecError(e) }
  }
}

/** Historical backfill for one mailbox. */
export async function spawnRipmailBackfillSource(
  sourceId: string,
  since: string,
): Promise<HubRipmailSpawnResult> {
  const id = sourceId.trim()
  if (!id) return { ok: false, error: 'source id required' }
  const spec = since.trim().toLowerCase()
  if (!isValidHubBackfillSince(spec)) {
    return { ok: false, error: 'invalid backfill window' }
  }
  try {
    // TS sync handles all sources; since-window is configured per-source in config.json
    await ripmailRefresh(ripmailHomeForBrain(), { sourceId: id })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: formatExecError(e) }
  }
}
