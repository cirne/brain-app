import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { globalDir } from './dataRoot.js'

export type TenantRegistryV1 = {
  v: 1
  /** Session cookie value → workspace handle (directory name under `BRAIN_DATA_ROOT`) */
  sessions: Record<string, string>
  /** e.g. `google:<sub>` → workspace handle (hosted identity map) */
  identities?: Record<string, string>
}

function registryPath(): string {
  return `${globalDir()}/tenant-registry.json`
}

async function readRegistry(): Promise<TenantRegistryV1> {
  const p = registryPath()
  if (!existsSync(p)) {
    return { v: 1, sessions: {}, identities: {} }
  }
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw) as TenantRegistryV1
    if (j.v !== 1 || typeof j.sessions !== 'object' || j.sessions === null) {
      return { v: 1, sessions: {}, identities: {} }
    }
    const identities =
      typeof j.identities === 'object' && j.identities !== null && !Array.isArray(j.identities)
        ? j.identities
        : {}
    return { ...j, identities }
  } catch {
    return { v: 1, sessions: {}, identities: {} }
  }
}

async function writeRegistry(reg: TenantRegistryV1): Promise<void> {
  const p = registryPath()
  mkdirSync(globalDir(), { recursive: true })
  await writeFile(p, JSON.stringify(reg, null, 2), 'utf-8')
}

/** Map a new vault session to a workspace (global registry on the data root volume). */
export async function registerSessionTenant(sessionId: string, workspaceHandle: string): Promise<void> {
  const reg = await readRegistry()
  reg.sessions[sessionId] = workspaceHandle
  await writeRegistry(reg)
}

/** Resolved workspace handle for the session, if registered. */
export async function lookupTenantBySession(sessionId: string | undefined): Promise<string | null> {
  if (!sessionId || sessionId.length < 8) return null
  const reg = await readRegistry()
  const wh = reg.sessions[sessionId]
  return typeof wh === 'string' && wh.length > 0 ? wh : null
}

export async function unregisterSessionTenant(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return
  const reg = await readRegistry()
  if (reg.sessions[sessionId] !== undefined) {
    delete reg.sessions[sessionId]
    await writeRegistry(reg)
  }
}

/** Returns workspace handle for a stable external identity key, if registered. */
export async function lookupWorkspaceByIdentity(key: string): Promise<string | null> {
  const reg = await readRegistry()
  const idents = reg.identities ?? {}
  const wh = idents[key]
  return typeof wh === 'string' && wh.length > 0 ? wh : null
}

export async function registerIdentityWorkspace(key: string, workspaceHandle: string): Promise<void> {
  const reg = await readRegistry()
  if (!reg.identities) reg.identities = {}
  reg.identities[key] = workspaceHandle
  await writeRegistry(reg)
}

/** Identity registry key (`google:<sub>`) that owns this workspace, if any. */
export async function lookupIdentityKeyForWorkspace(workspaceHandle: string): Promise<string | null> {
  const reg = await readRegistry()
  const idents = reg.identities ?? {}
  for (const [k, h] of Object.entries(idents)) {
    if (h === workspaceHandle) return k
  }
  return null
}
