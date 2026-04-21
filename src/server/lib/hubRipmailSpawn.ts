import { formatExecError } from './execError.js'
import { runRipmailBackfillForBrain, runRipmailRefreshForBrain } from './ripmailHeavySpawn.js'

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

/** Incremental sync for one mailbox (`ripmail refresh --source <id>`). */
export async function spawnRipmailRefreshSource(sourceId: string): Promise<HubRipmailSpawnResult> {
  const id = sourceId.trim()
  if (!id) return { ok: false, error: 'source id required' }
  try {
    await runRipmailRefreshForBrain(['--source', id])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: formatExecError(e) }
  }
}

/** Historical backfill for one mailbox (`ripmail backfill --since <spec> --source <id>`). */
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
    await runRipmailBackfillForBrain(['--since', spec, '--source', id])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: formatExecError(e) }
  }
}
