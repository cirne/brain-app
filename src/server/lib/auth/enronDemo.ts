import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'
import { getBearerToken } from '@server/lib/vault/embedKeyAuth.js'
import { readHandleMeta, writeHandleMeta, isValidUserId } from '@server/lib/tenant/handleMeta.js'

/** Default demo tenant (Steven Kean); kept for tests and legacy env overrides. */
export const ENRON_DEMO_TENANT_USER_ID_DEFAULT = 'usr_enrondemo00000000001'

export type EnronDemoRegistryUser = {
  key: string
  label: string
  tenantUserId: string
  workspaceHandle: string
  manifestFile: string
}

export type EnronDemoRegistryFile = {
  users: EnronDemoRegistryUser[]
}

let cachedRegistry: EnronDemoRegistryFile | null = null

/** Tests may change cwd or BRAIN_SEED_REPO_ROOT between cases. */
export function resetEnronDemoRegistryCacheForTests(): void {
  cachedRegistry = null
}

function repoRootForRegistry(): string {
  const env = process.env.BRAIN_SEED_REPO_ROOT?.trim()
  if (env) return env
  return process.cwd()
}

export function loadEnronDemoRegistry(): EnronDemoRegistryFile {
  if (cachedRegistry) return cachedRegistry
  const root = repoRootForRegistry()
  const p = join(root, 'eval/fixtures/enron-demo-registry.json')
  const raw = readFileSync(p, 'utf8')
  const j = JSON.parse(raw) as EnronDemoRegistryFile
  if (!j.users?.length) {
    throw new Error(`Invalid Enron demo registry: ${p}`)
  }
  for (const u of j.users) {
    if (
      typeof u.key !== 'string' ||
      typeof u.label !== 'string' ||
      typeof u.tenantUserId !== 'string' ||
      typeof u.workspaceHandle !== 'string' ||
      typeof u.manifestFile !== 'string'
    ) {
      throw new Error(`Invalid Enron demo registry user entry in ${p}`)
    }
    if (!isValidUserId(u.tenantUserId)) {
      throw new Error(`Invalid tenantUserId in Enron demo registry: ${u.tenantUserId}`)
    }
  }
  cachedRegistry = j
  return j
}

/** Public picker payload (no secrets). */
export function listEnronDemoUsersPublic(): Array<{ key: string; label: string }> {
  return loadEnronDemoRegistry().users.map(u => ({ key: u.key, label: u.label }))
}

export function resolveEnronDemoUserByKey(rawKey: string): EnronDemoRegistryUser | undefined {
  const k = rawKey.trim().toLowerCase()
  return loadEnronDemoRegistry().users.find(u => u.key === k)
}

export function getEnronDemoUserKeyByTenantId(tenantUserId: string): string | undefined {
  return loadEnronDemoRegistry().users.find(u => u.tenantUserId === tenantUserId)?.key
}

export function isEnronDemoRegisteredTenantId(tenantUserId: string): boolean {
  return loadEnronDemoRegistry().users.some(u => u.tenantUserId === tenantUserId)
}

/**
 * Legacy helper: effective tenant id when a single-tenant override is set, otherwise Kean's id.
 * Prefer resolving via {@link resolveEnronDemoUserByKey}.
 */
export function enronDemoTenantUserId(): string {
  const o = process.env.BRAIN_ENRON_DEMO_TENANT_ID?.trim()
  if (o && o.length > 0) return o
  return resolveEnronDemoUserByKey('kean')?.tenantUserId ?? ENRON_DEMO_TENANT_USER_ID_DEFAULT
}

export const ENRON_DEMO_MINT_PATH = '/api/auth/demo/enron'

/** GET — list demo personas for `/demo` picker (no Bearer; enabled only when demo secret is configured). */
export const ENRON_DEMO_USERS_PATH = '/api/auth/demo/enron/users'

/** GET — seed snapshot for UI / automation (same bearer as POST mint); used during operator **reseed**, not first-time mint. */
export const ENRON_DEMO_SEED_STATUS_PATH = '/api/auth/demo/enron/seed-status'

/** GET — wipe tenant + rebuild Enron corpus (same secret as POST mint; optional `?secret=` for browser GET). */
export const ENRON_DEMO_RESEED_PATH = '/api/auth/demo/enron/reseed'

export function isEnronDemoUsersListPath(path: string, method: string): boolean {
  return (
    method === 'GET' && (path === ENRON_DEMO_USERS_PATH || path === `${ENRON_DEMO_USERS_PATH}/`)
  )
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

/** Routes that bypass vault + tenant gate (handler enforces demo secret + bearer except users list). */
export function isEnronDemoPublicApiPath(path: string, method: string): boolean {
  return (
    isEnronDemoUsersListPath(path, method) ||
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
 * Optional operator lock: when `BRAIN_ENRON_DEMO_TENANT_ID` is set, mint/seed only allowed for that tenant.
 */
export function enronDemoTenantIdEnvAllows(user: EnronDemoRegistryUser): boolean {
  const envTid = process.env.BRAIN_ENRON_DEMO_TENANT_ID?.trim()
  if (!envTid) return true
  return envTid === user.tenantUserId
}

/**
 * If this tenant is an Enron demo user and `handle-meta.json` is missing, create it so
 * hosted onboarding (`/api/account/handle*`) does not 500 (Bearer mint does not run Google identity setup).
 */
export async function ensureEnronDemoHandleMetaFile(
  homeDir: string,
  tenantUserId: string,
  workspaceHandle: string,
): Promise<void> {
  if (!enronDemoSecretConfigured()) return
  if (!isEnronDemoRegisteredTenantId(tenantUserId)) return
  if (await readHandleMeta(homeDir)) return
  const handle = workspaceHandle.trim() || 'enron-demo'
  await writeHandleMeta(homeDir, {
    userId: tenantUserId,
    handle,
    confirmedAt: null,
  })
}
