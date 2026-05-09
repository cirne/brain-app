import { readdir } from 'node:fs/promises'
import { dataRoot } from './dataRoot.js'
import { isValidUserId } from './handleMeta.js'

/**
 * Return every `usr_*` tenant directory name under `BRAIN_DATA_ROOT` (excludes `.global` and other noise).
 * Used for server-side sweeps (scheduled mail sync); prefer request-scoped tenant context for normal API work.
 */
export async function listTenantUserIdsUnderDataRoot(): Promise<string[]> {
  const root = dataRoot()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of names) {
    if (!isValidUserId(name)) continue
    out.push(name)
  }
  out.sort()
  return out
}
