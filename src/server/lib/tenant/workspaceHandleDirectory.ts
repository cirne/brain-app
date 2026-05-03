/**
 * Cross-tenant directory of **confirmed** workspace handles for collaborator-picker UIs
 * (e.g. wiki sharing). Scans every `usr_*` tenant under `BRAIN_DATA_ROOT` for `handle-meta.json`
 * and pairs each match with the tenant's primary mailbox email so the UI can show
 * `name + email` verification.
 *
 * Intentionally simple: linear scan, no global index. Move to a SQLite mirror if/when the
 * tenant count grows enough that the directory is hot.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { brainLayoutRipmailDir } from '@server/lib/platform/brainLayout.js'
import {
  readPrimaryRipmailImapEmail,
} from '@server/lib/platform/googleOAuth.js'
import { dataRoot, tenantHomeDir } from './dataRoot.js'
import { isValidUserId, readHandleMeta } from './handleMeta.js'
import { readLinkedMailboxesFor } from './linkedMailboxes.js'

export type WorkspaceHandleDirectoryEntry = {
  /** `usr_…` tenant id (stable identifier). */
  userId: string
  /** Confirmed display handle. */
  handle: string
  /** Full name from Google OIDC `profile`, when known. */
  displayName?: string
  /** Primary linked mailbox email; null when the user has not connected mail yet. */
  primaryEmail: string | null
}

/** Default cap on results returned to callers (autocomplete dropdown size). */
export const WORKSPACE_HANDLE_DIRECTORY_DEFAULT_LIMIT = 20

/** Pick the primary linked mailbox email for a tenant, falling back to ripmail config. */
async function resolvePrimaryEmail(home: string): Promise<string | null> {
  const linked = await readLinkedMailboxesFor(home)
  const primary = linked.mailboxes.find((m) => m.isPrimary === true) ?? linked.mailboxes[0]
  if (primary) return primary.email
  const fromConfig = await readPrimaryRipmailImapEmail(brainLayoutRipmailDir(home))
  return fromConfig ? fromConfig.toLowerCase() : null
}

/**
 * Search confirmed workspace handles by case-insensitive prefix. Excludes `excludeUserId`
 * (typically the caller's own tenant). Returns up to `limit` rows sorted by handle.
 */
export async function searchWorkspaceHandleDirectory(params: {
  prefix: string
  excludeUserId?: string
  limit?: number
}): Promise<WorkspaceHandleDirectoryEntry[]> {
  const limit = params.limit ?? WORKSPACE_HANDLE_DIRECTORY_DEFAULT_LIMIT
  const normalizedPrefix = params.prefix.trim().toLowerCase().replace(/^@/, '')
  const root = dataRoot()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const candidates: { userId: string; handle: string; displayName?: string }[] = []
  for (const name of names) {
    if (!isValidUserId(name)) continue
    if (params.excludeUserId && name === params.excludeUserId) continue
    const meta = await readHandleMeta(join(root, name))
    if (!meta) continue
    if (typeof meta.confirmedAt !== 'string' || meta.confirmedAt.length === 0) continue
    if (normalizedPrefix.length > 0 && !meta.handle.toLowerCase().startsWith(normalizedPrefix)) continue
    const row: { userId: string; handle: string; displayName?: string } = {
      userId: meta.userId,
      handle: meta.handle,
    }
    if (meta.displayName) row.displayName = meta.displayName
    candidates.push(row)
  }
  candidates.sort((a, b) => a.handle.localeCompare(b.handle))
  const capped = candidates.slice(0, limit)
  const out: WorkspaceHandleDirectoryEntry[] = []
  for (const c of capped) {
    const primaryEmail = await resolvePrimaryEmail(tenantHomeDir(c.userId))
    const entry: WorkspaceHandleDirectoryEntry = {
      userId: c.userId,
      handle: c.handle,
      primaryEmail,
    }
    if (c.displayName) entry.displayName = c.displayName
    out.push(entry)
  }
  return out
}

/**
 * Find a confirmed tenant whose primary mailbox (linked mailboxes or ripmail config) matches `email`
 * (case-insensitive). If multiple tenants share the same primary, the first match in directory order wins.
 */
export async function resolveUserIdByPrimaryEmail(params: {
  email: string
  excludeUserId?: string
}): Promise<string | null> {
  const normalized = params.email.trim().toLowerCase()
  if (!normalized.includes('@')) return null
  const root = dataRoot()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return null
  }
  for (const name of names) {
    if (!isValidUserId(name)) continue
    if (params.excludeUserId && name === params.excludeUserId) continue
    const primary = await resolvePrimaryEmail(join(root, name))
    if (primary && primary.toLowerCase() === normalized) return name
  }
  return null
}

/**
 * Resolve a single confirmed handle (exact, case-insensitive) to a full directory entry.
 * Returns null when no confirmed tenant owns the handle.
 */
export async function resolveConfirmedHandle(params: {
  handle: string
  excludeUserId?: string
}): Promise<WorkspaceHandleDirectoryEntry | null> {
  const wanted = params.handle.trim().toLowerCase().replace(/^@/, '')
  if (!wanted) return null
  const root = dataRoot()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return null
  }
  for (const name of names) {
    if (!isValidUserId(name)) continue
    if (params.excludeUserId && name === params.excludeUserId) continue
    const home = join(root, name)
    const meta = await readHandleMeta(home)
    if (!meta) continue
    if (typeof meta.confirmedAt !== 'string' || meta.confirmedAt.length === 0) continue
    if (meta.handle.toLowerCase() !== wanted) continue
    const primaryEmail = await resolvePrimaryEmail(home)
    const entry: WorkspaceHandleDirectoryEntry = {
      userId: meta.userId,
      handle: meta.handle,
      primaryEmail,
    }
    if (meta.displayName) entry.displayName = meta.displayName
    return entry
  }
  return null
}
