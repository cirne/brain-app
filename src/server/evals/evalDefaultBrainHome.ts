import { join, resolve } from 'node:path'
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'

/**
 * Eval JSONL harness runs like local multi-tenant dev: Kean's tenant dir under `BRAIN_DATA_ROOT`.
 * Defaults `BRAIN_DATA_ROOT` to `<repo>/data` when unset (same as `npm run eval:run`).
 */
export function ensureEvalDataRootForRepo(repoRoot: string): void {
  if (!process.env.BRAIN_DATA_ROOT?.trim()) {
    process.env.BRAIN_DATA_ROOT = join(repoRoot, 'data')
  }
}

/** Default `BRAIN_HOME` for mail-backed evals: Kean demo tenant under `./data` (or `$BRAIN_DATA_ROOT`). */
export function resolveDefaultEvalBrainHome(repoRoot: string): string {
  ensureEvalDataRootForRepo(repoRoot)
  return tenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
}

/** Resolved brain home: explicit `BRAIN_HOME`, else Kean tenant directory. */
export function resolveEvalBrainHome(repoRoot: string): string {
  const raw = process.env.BRAIN_HOME?.trim()
  if (raw) return resolve(raw)
  return resolveDefaultEvalBrainHome(repoRoot)
}
