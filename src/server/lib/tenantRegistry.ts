import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { globalDir } from './dataRoot.js'
import { isValidUserId } from './handleMeta.js'

export type TenantRegistryV1 = {
  v: 1
  /** Session cookie value → tenant directory key (`usr_…` under `BRAIN_DATA_ROOT`) */
  sessions: Record<string, string>
  /** e.g. `google:<sub>` → tenant directory key (`usr_…`) */
  identities?: Record<string, string>
  /**
   * Legacy duplicate of identity→tenant mapping (pre–userId dirs). Removed after migration.
   * @deprecated DELETE when {@link migrateTenantDirsToUserId.ts} is deleted.
   */
  userIds?: Record<string, string>
}

function registryPath(): string {
  return `${globalDir()}/tenant-registry.json`
}

async function readRegistry(): Promise<TenantRegistryV1> {
  const p = registryPath()
  if (!existsSync(p)) {
    return { v: 1, sessions: {}, identities: {}, userIds: {} }
  }
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw) as TenantRegistryV1
    if (j.v !== 1 || typeof j.sessions !== 'object' || j.sessions === null) {
      return { v: 1, sessions: {}, identities: {}, userIds: {} }
    }
    const identities =
      typeof j.identities === 'object' && j.identities !== null && !Array.isArray(j.identities)
        ? j.identities
        : {}
    const userIds =
      typeof j.userIds === 'object' && j.userIds !== null && !Array.isArray(j.userIds)
        ? j.userIds
        : {}
    return { ...j, identities, userIds }
  } catch {
    return { v: 1, sessions: {}, identities: {}, userIds: {} }
  }
}

async function writeRegistry(reg: TenantRegistryV1): Promise<void> {
  const p = registryPath()
  mkdirSync(globalDir(), { recursive: true })
  await writeFile(p, JSON.stringify(reg, null, 2), 'utf-8')
}

/** Map a new vault session to a tenant (`usr_…` directory key). */
export async function registerSessionTenant(sessionId: string, tenantUserId: string): Promise<void> {
  const reg = await readRegistry()
  reg.sessions[sessionId] = tenantUserId
  await writeRegistry(reg)
}

/** Resolved tenant user id for the session, if registered. */
export async function lookupTenantBySession(sessionId: string | undefined): Promise<string | null> {
  if (!sessionId || sessionId.length < 8) return null
  const reg = await readRegistry()
  const id = reg.sessions[sessionId]
  return typeof id === 'string' && id.length > 0 ? id : null
}

export async function unregisterSessionTenant(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return
  const reg = await readRegistry()
  if (reg.sessions[sessionId] !== undefined) {
    delete reg.sessions[sessionId]
    await writeRegistry(reg)
  }
}

/** Returns tenant user id (`usr_…`) for a stable external identity key, if registered. */
export async function lookupWorkspaceByIdentity(key: string): Promise<string | null> {
  const reg = await readRegistry()
  const idents = reg.identities ?? {}
  const id = idents[key]
  return typeof id === 'string' && id.length > 0 ? id : null
}

export async function registerIdentityWorkspace(key: string, tenantUserId: string): Promise<void> {
  const reg = await readRegistry()
  if (!reg.identities) reg.identities = {}
  reg.identities[key] = tenantUserId
  await writeRegistry(reg)
}

/** @deprecated Prefer {@link registerIdentityWorkspace}; identities map holds userId. Kept for migration reads. */
export async function registerIdentityUserId(key: string, userId: string): Promise<void> {
  await registerIdentityWorkspace(key, userId)
}

/** Resolved tenant user id for identity key (same as lookupWorkspaceByIdentity). */
export async function lookupUserIdByIdentity(key: string): Promise<string | null> {
  return lookupWorkspaceByIdentity(key)
}

/** Identity registry key (`google:<sub>`) that owns this tenant dir, if any. */
export async function lookupIdentityKeyForTenantUserId(tenantUserId: string): Promise<string | null> {
  const reg = await readRegistry()
  const idents = reg.identities ?? {}
  for (const [k, h] of Object.entries(idents)) {
    if (h === tenantUserId) return k
  }
  return null
}

/** @deprecated Use {@link lookupIdentityKeyForTenantUserId} with `usr_…` id. */
export async function lookupIdentityKeyForWorkspace(workspaceHandle: string): Promise<string | null> {
  return lookupIdentityKeyForTenantUserId(workspaceHandle)
}

/** Remove every identity row pointing at this tenant user id (hosted delete-account). */
export async function removeIdentityMappingsForTenantUserId(tenantUserId: string): Promise<void> {
  const reg = await readRegistry()
  if (!reg.identities) return
  let changed = false
  for (const [k, h] of Object.entries(reg.identities)) {
    if (h === tenantUserId) {
      delete reg.identities[k]
      changed = true
    }
  }
  if (reg.userIds) {
    for (const [k, uid] of Object.entries(reg.userIds)) {
      if (uid === tenantUserId) {
        delete reg.userIds[k]
        changed = true
      }
    }
  }
  if (changed) await writeRegistry(reg)
}

/** @deprecated Use {@link removeIdentityMappingsForTenantUserId}. */
export async function removeIdentityMappingsForWorkspace(workspaceHandle: string): Promise<void> {
  await removeIdentityMappingsForTenantUserId(workspaceHandle)
}

/**
 * ONE-TIME MIGRATION ONLY — DELETE when {@link migrateTenantDirsToUserId.ts} is removed.
 * Rewrites registry values that still use legacy handle directory names.
 */
export async function remapRegistryTenantDirectoryKeys(handleToUserId: Record<string, string>): Promise<void> {
  const reg = await readRegistry()
  let changed = false
  const swap = (v: string): string => handleToUserId[v] ?? v

  for (const sid of Object.keys(reg.sessions)) {
    const v = reg.sessions[sid]
    const nu = swap(v)
    if (nu !== v) {
      reg.sessions[sid] = nu
      changed = true
    }
  }
  const idents = reg.identities ?? {}
  for (const k of Object.keys(idents)) {
    const v = idents[k]
    if (typeof v !== 'string') continue
    const nu = swap(v)
    if (nu !== v) {
      idents[k] = nu
      changed = true
    }
  }
  reg.identities = idents
  const uids = reg.userIds ?? {}
  for (const k of Object.keys(uids)) {
    const v = uids[k]
    if (typeof v !== 'string') continue
    const nu = swap(v)
    if (nu !== v) {
      uids[k] = nu
      changed = true
    }
  }
  reg.userIds = uids
  if (changed) await writeRegistry(reg)
}

/**
 * ONE-TIME MIGRATION ONLY — DELETE when {@link migrateTenantDirsToUserId.ts} is removed.
 * Merge legacy `userIds` into `identities` and drop duplicate column.
 */
export async function normalizeRegistryAfterTenantDirMigration(): Promise<void> {
  const reg = await readRegistry()
  const idents = reg.identities ?? {}
  const uids = reg.userIds ?? {}
  let changed = false
  for (const [k, uid] of Object.entries(uids)) {
    if (typeof uid !== 'string' || !isValidUserId(uid)) continue
    if (idents[k] !== uid) {
      idents[k] = uid
      changed = true
    }
  }
  if (reg.userIds && Object.keys(reg.userIds).length > 0) {
    delete reg.userIds
    changed = true
  }
  reg.identities = idents
  if (changed) await writeRegistry(reg)
}
