import { timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { getBearerToken } from '@server/lib/vault/embedKeyAuth.js'
import { readHandleMeta, writeHandleMeta } from '@server/lib/tenant/handleMeta.js'

/** Default demo tenant directory under `BRAIN_DATA_ROOT` (see OPP-051 Phase 0). */
export const ENRON_DEMO_TENANT_USER_ID_DEFAULT = 'usr_enrondemo00000000001'

export const ENRON_DEMO_MINT_PATH = '/api/auth/demo/enron'

/** GET — poll while lazy seed runs (same bearer as POST mint). */
export const ENRON_DEMO_SEED_STATUS_PATH = '/api/auth/demo/enron/seed-status'

/** GET — wipe tenant + rebuild Enron corpus (same secret as POST mint; optional `?secret=` for browser GET). */
export const ENRON_DEMO_RESEED_PATH = '/api/auth/demo/enron/reseed'

/** Effective tenant id; override must satisfy {@link isValidUserId}. */
export function enronDemoTenantUserId(): string {
  const o = process.env.BRAIN_ENRON_DEMO_TENANT_ID?.trim()
  if (o && o.length > 0) return o
  return ENRON_DEMO_TENANT_USER_ID_DEFAULT
}

export function isEnronDemoMintPath(path: string, method: string): boolean {
  return (
    method === 'POST' && (path === ENRON_DEMO_MINT_PATH || path === `${ENRON_DEMO_MINT_PATH}/`)
  )
}

export function isEnronDemoSeedStatusPath(path: string, method: string): boolean {
  return (
    method === 'GET' &&
    (path === ENRON_DEMO_SEED_STATUS_PATH || path === `${ENRON_DEMO_SEED_STATUS_PATH}/`)
  )
}

export function isEnronDemoReseedPath(path: string, method: string): boolean {
  return (
    method === 'GET' &&
    (path === ENRON_DEMO_RESEED_PATH || path === `${ENRON_DEMO_RESEED_PATH}/`)
  )
}

/** Routes that bypass vault + tenant gate (handler enforces demo secret + bearer). */
export function isEnronDemoPublicApiPath(path: string, method: string): boolean {
  return (
    isEnronDemoMintPath(path, method) ||
    isEnronDemoSeedStatusPath(path, method) ||
    isEnronDemoReseedPath(path, method)
  )
}

function secureStringEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** True when `Authorization: Bearer` matches `BRAIN_ENRON_DEMO_SECRET` (non-empty, timing-safe). */
export function isValidEnronDemoBearer(c: Context): boolean {
  const key = process.env.BRAIN_ENRON_DEMO_SECRET?.trim()
  if (key == null || key.length === 0) return false
  const token = getBearerToken(c)
  if (token == null) return false
  return secureStringEqual(key, token)
}

/**
 * GET reseed only: Bearer or `?secret=` (timing-safe) so a bookmark can trigger reseed without a custom header.
 * Avoid sharing URLs with the secret in query (logs, Referer).
 */
export function isValidEnronDemoReseedRequest(c: Context): boolean {
  if (isValidEnronDemoBearer(c)) return true
  const key = process.env.BRAIN_ENRON_DEMO_SECRET?.trim()
  if (key == null || key.length === 0) return false
  const q = c.req.query('secret')
  if (q == null || q.length === 0) return false
  return secureStringEqual(key, q)
}

/** Enron demo routes and hosted link are enabled when `BRAIN_ENRON_DEMO_SECRET` trims to a non-empty string. */
export function enronDemoSecretConfigured(): boolean {
  const key = process.env.BRAIN_ENRON_DEMO_SECRET?.trim()
  return key != null && key.length > 0
}

/**
 * If this tenant is the configured Enron demo user and `handle-meta.json` is missing, create it so
 * hosted onboarding (`/api/account/handle*`) does not 500 (Bearer mint does not run Google identity setup).
 */
export async function ensureEnronDemoHandleMetaFile(
  homeDir: string,
  tenantUserId: string,
  workspaceHandle: string,
): Promise<void> {
  if (!enronDemoSecretConfigured()) return
  if (tenantUserId !== enronDemoTenantUserId()) return
  if (await readHandleMeta(homeDir)) return
  const handle = workspaceHandle.trim() || 'enron-demo'
  await writeHandleMeta(homeDir, {
    userId: tenantUserId,
    handle,
    confirmedAt: null,
  })
}
