import process from 'node:process'
import { spawn } from 'node:child_process'
import { formatExecError } from './execError.js'
import { ripmailBin } from './ripmailBin.js'
import { ripmailProcessEnv } from './ripmailExec.js'

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

function spawnRipmailDetached(args: string[]): Promise<HubRipmailSpawnResult> {
  const rm = ripmailBin()
  return new Promise((resolve) => {
    const child = spawn(rm, args, {
      detached: true,
      stdio: 'ignore',
      env: ripmailProcessEnv() as typeof process.env,
    })
    const done = (result: HubRipmailSpawnResult) => {
      child.removeAllListeners()
      resolve(result)
    }
    child.once('error', (err) => {
      const detail = formatExecError(err)
      console.error('[brain-app] ripmail spawn failed:', detail, args.join(' '))
      done({ ok: false, error: detail })
    })
    child.once('spawn', () => {
      child.unref()
      done({ ok: true })
    })
  })
}

/** Incremental sync for one mailbox (`ripmail refresh --source <id>`). */
export function spawnRipmailRefreshSource(sourceId: string): Promise<HubRipmailSpawnResult> {
  const id = sourceId.trim()
  if (!id) return Promise.resolve({ ok: false, error: 'source id required' })
  return spawnRipmailDetached(['refresh', '--source', id])
}

/** Historical backfill for one mailbox (`ripmail backfill --since <spec> --source <id>`). */
export function spawnRipmailBackfillSource(
  sourceId: string,
  since: string,
): Promise<HubRipmailSpawnResult> {
  const id = sourceId.trim()
  if (!id) return Promise.resolve({ ok: false, error: 'source id required' })
  const spec = since.trim().toLowerCase()
  if (!isValidHubBackfillSince(spec)) {
    return Promise.resolve({ ok: false, error: 'invalid backfill window' })
  }
  return spawnRipmailDetached(['backfill', '--since', spec, '--source', id])
}
