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

/**
 * Ranking for handle queries (lower = sort first): full-handle prefix → segment-prefix → substring.
 * Segment boundaries: `-`, `_`, `.`.
 */
export function workspaceHandleMatchRank(handleLower: string, q: string): number | null {
  const needle = q.trim().toLowerCase().replace(/^@/, '')
  if (needle.length === 0) return 0
  if (handleLower.startsWith(needle)) return 0
  const segments = handleLower.split(/[-_.]+/).filter(Boolean)
  for (const seg of segments) {
    if (seg.startsWith(needle)) return 1
  }
  if (handleLower.includes(needle)) return 2
  return null
}

/**
 * Loose ranking for display name / email: full-string prefix → word-prefix → substring.
 * Words split on non-alphanumeric (handles "Jane Q. Public" vs `jane`).
 */
export function directoryTextMatchRank(haystackLower: string, needle: string): number | null {
  const n = needle.trim().toLowerCase().replace(/^@/, '')
  if (n.length === 0) return 0
  if (!haystackLower.includes(n)) return null
  if (haystackLower.startsWith(n)) return 0
  const segments = haystackLower.split(/[^a-z0-9]+/).filter(Boolean)
  for (const seg of segments) {
    if (seg.startsWith(n)) return 1
  }
  return 2
}

/** Pick the primary linked mailbox email for a tenant, falling back to ripmail config. */
async function resolvePrimaryEmail(home: string): Promise<string | null> {
  const linked = await readLinkedMailboxesFor(home)
  const primary = linked.mailboxes.find((m) => m.isPrimary === true) ?? linked.mailboxes[0]
  if (primary) return primary.email
  const fromConfig = await readPrimaryRipmailImapEmail(brainLayoutRipmailDir(home))
  return fromConfig ? fromConfig.toLowerCase() : null
}

/** Primary mailbox for a tenant id (`usr_…`), or null if unknown / not configured. */
export async function getPrimaryEmailForUserId(userId: string): Promise<string | null> {
  const id = userId.trim()
  if (!isValidUserId(id)) return null
  return resolvePrimaryEmail(tenantHomeDir(id))
}

/**
 * Search confirmed workspace handles by case-insensitive substring (`query`). Excludes `excludeUserId`
 * (typically the caller's own tenant). Matches handle (ranked as in {@link workspaceHandleMatchRank}),
 * display name, and primary email. Sorts by best rank then handle.
 */
export async function searchWorkspaceHandleDirectory(params: {
  /** Search text (`@` prefix ignored). Empty returns all handles (still capped). */
  query: string
  excludeUserId?: string
  limit?: number
}): Promise<WorkspaceHandleDirectoryEntry[]> {
  const limit = params.limit ?? WORKSPACE_HANDLE_DIRECTORY_DEFAULT_LIMIT
  const normalizedQuery = params.query.trim().toLowerCase().replace(/^@/, '')
  const root = dataRoot()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const candidates: {
    userId: string
    handle: string
    displayName?: string
    rank: number
    primaryEmail: string | null
  }[] = []
  for (const name of names) {
    if (!isValidUserId(name)) continue
    if (params.excludeUserId && name === params.excludeUserId) continue
    const home = join(root, name)
    const meta = await readHandleMeta(home)
    if (!meta) continue
    if (typeof meta.confirmedAt !== 'string' || meta.confirmedAt.length === 0) continue
    const handleLower = meta.handle.toLowerCase()
    const primaryEmail = await resolvePrimaryEmail(tenantHomeDir(meta.userId))
    if (normalizedQuery.length > 0) {
      let best: number | null = null
      const hr = workspaceHandleMatchRank(handleLower, normalizedQuery)
      if (hr !== null) best = hr
      const dn = meta.displayName?.trim().toLowerCase() ?? ''
      if (dn.length > 0) {
        const dr = directoryTextMatchRank(dn, normalizedQuery)
        if (dr !== null) best = best === null ? dr : Math.min(best, dr)
      }
      const el = primaryEmail?.toLowerCase() ?? ''
      if (el.length > 0) {
        const er = directoryTextMatchRank(el, normalizedQuery)
        if (er !== null) best = best === null ? er : Math.min(best, er)
      }
      if (best === null) continue
      const row: {
        userId: string
        handle: string
        displayName?: string
        rank: number
        primaryEmail: string | null
      } = {
        userId: meta.userId,
        handle: meta.handle,
        rank: best,
        primaryEmail,
      }
      if (meta.displayName) row.displayName = meta.displayName
      candidates.push(row)
    } else {
      const row: {
        userId: string
        handle: string
        displayName?: string
        rank: number
        primaryEmail: string | null
      } = {
        userId: meta.userId,
        handle: meta.handle,
        rank: 0,
        primaryEmail,
      }
      if (meta.displayName) row.displayName = meta.displayName
      candidates.push(row)
    }
  }
  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.handle.localeCompare(b.handle)
  })
  const capped = candidates.slice(0, limit)
  const out: WorkspaceHandleDirectoryEntry[] = []
  for (const c of capped) {
    const entry: WorkspaceHandleDirectoryEntry = {
      userId: c.userId,
      handle: c.handle,
      primaryEmail: c.primaryEmail,
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
 * Confirmed tenant directory row for `userId` (for stable client picks), or null if missing / unconfirmed / excluded.
 */
export async function resolveConfirmedTenantEntry(params: {
  userId: string
  excludeUserId?: string
}): Promise<WorkspaceHandleDirectoryEntry | null> {
  const id = params.userId.trim()
  if (!isValidUserId(id)) return null
  if (params.excludeUserId && id === params.excludeUserId) return null
  const home = tenantHomeDir(id)
  const meta = await readHandleMeta(home)
  if (!meta) return null
  if (typeof meta.confirmedAt !== 'string' || meta.confirmedAt.length === 0) return null
  const primaryEmail = await resolvePrimaryEmail(home)
  const entry: WorkspaceHandleDirectoryEntry = {
    userId: meta.userId,
    handle: meta.handle,
    primaryEmail,
  }
  if (meta.displayName) entry.displayName = meta.displayName
  return entry
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
