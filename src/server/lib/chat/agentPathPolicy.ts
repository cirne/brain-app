/**
 * Agent tool path policy for BUG-012: jail filesystem paths to tenant roots + indexed sources.
 */

import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { normalize, resolve } from 'node:path'
import { brainHome, ripmailHomeForBrain, wikiContentDir } from '@server/lib/platform/brainHome.js'
import { dataRoot } from '@server/lib/tenant/dataRoot.js'
import { ripmailSourcesList } from '@server/ripmail/index.js'
import {
  PathEscapeError,
  isAbsolutePathAllowedUnderRoots,
  isPathStrictlyInsideOrEqual,
  normalizePathThroughExistingAncestors,
} from '@server/lib/tenant/resolveTenantSafePath.js'

/** True if `ripmail read` id should be treated as a filesystem path (vs Message-ID). */
export function ripmailReadIdLooksLikeFilesystemPath(id: string): boolean {
  const s = id.trim()
  if (!s) return false
  if (s.startsWith('~/') || s.startsWith('~\\')) return true
  if (s.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(s)) return true
  if (s.startsWith('\\\\')) return true
  return false
}

/** Expand ~ and return a normalized absolute path (same rules as `/api/files/read`). */
export function expandRawPathToAbsolute(raw: string): string {
  let p = raw.trim()
  if (p.startsWith('~/')) {
    p = resolve(homedir(), p.slice(2))
  } else {
    p = resolve(p)
  }
  return normalize(p)
}

export type RipmailSourceRowForPathPolicy = {
  kind?: string
  path?: string
}

/** Collect configured filesystem roots from `ripmail sources list --json` (localDir + icsFile). */
export function indexedFolderRootsFromSourcesListJson(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object') return []
  const sources = (parsed as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return []
  const out: string[] = []
  for (const row of sources) {
    if (!row || typeof row !== 'object') continue
    const r = row as RipmailSourceRowForPathPolicy
    const kind = typeof r.kind === 'string' ? r.kind : ''
    const pathStr = typeof r.path === 'string' ? r.path.trim() : ''
    if (!pathStr) continue
    if (kind === 'localDir' || kind === 'icsFile') {
      try {
        out.push(expandRawPathToAbsolute(pathStr))
      } catch {
        continue
      }
    }
  }
  return out
}

/** Return indexed folder/file roots from the in-process TS ripmail module (best-effort). */
export async function loadRipmailIndexedFolderRoots(): Promise<string[]> {
  try {
    const { ripmailHomeForBrain } = await import('@server/lib/platform/brainHome.js')
    const { sources } = ripmailSourcesList(ripmailHomeForBrain())
    return indexedFolderRootsFromSourcesListJson({ sources })
  } catch {
    return []
  }
}

/**
 * Reject registering or editing a source path that falls inside another tenant's home under
 * `BRAIN_DATA_ROOT` (multi-tenant only).
 */
export function assertManageSourcePathNotInsideSiblingTenant(expandedAbsolutePath: string): void {
  const mine = normalizePathThroughExistingAncestors(brainHome())
  const dr = dataRoot()
  let entries
  try {
    entries = readdirSync(dr, { withFileTypes: true })
  } catch {
    return
  }
  const cand = normalizePathThroughExistingAncestors(expandedAbsolutePath)
  for (const e of entries) {
    const name = String(e.name)
    if (!e.isDirectory() || name.startsWith('.') || name === 'lost+found') continue
    const siblingRoot = resolve(dr, name)
    let realSibling: string
    try {
      realSibling = normalizePathThroughExistingAncestors(siblingRoot)
    } catch {
      continue
    }
    if (realSibling === mine) continue
    if (isPathStrictlyInsideOrEqual(cand, siblingRoot)) {
      throw new PathEscapeError('path_not_allowed: overlaps another tenant workspace')
    }
  }
}

export type ReadPathAllowlist = {
  brain: string
  ripmail: string
  wiki: string
  indexedRoots: string[]
}

export async function buildReadPathAllowlist(): Promise<ReadPathAllowlist> {
  const indexedRoots = await loadRipmailIndexedFolderRoots()
  return {
    brain: brainHome(),
    ripmail: ripmailHomeForBrain(),
    wiki: wikiContentDir(),
    indexedRoots,
  }
}

/** True if `absolutePath` may be read via **`read_indexed_file`** / `/api/files/read` for this tenant. */
export function isAgentReadPathAllowed(absolutePath: string, list: ReadPathAllowlist): boolean {
  const extras = [list.ripmail, list.wiki, ...list.indexedRoots]
  return isAbsolutePathAllowedUnderRoots(absolutePath, list.brain, extras)
}

/**
 * Expand and validate a path for read tools; throws {@link PathEscapeError} if not allowed.
 * Checks brain / ripmail / wiki roots first (no subprocess); loads indexed folder sources only when needed.
 */
export async function assertAgentReadPathAllowed(rawPath: string): Promise<string> {
  const expanded = expandRawPathToAbsolute(rawPath)
  const brain = brainHome()
  const rip = ripmailHomeForBrain()
  const wiki = wikiContentDir()
  if (isAbsolutePathAllowedUnderRoots(expanded, brain, [rip, wiki])) {
    return expanded
  }
  const indexedRoots = await loadRipmailIndexedFolderRoots()
  if (isAbsolutePathAllowedUnderRoots(expanded, brain, [rip, wiki, ...indexedRoots])) {
    return expanded
  }
  throw new PathEscapeError('path_not_allowed_for_this_tenant')
}

/**
 * Validate path for `manage_sources` add/edit: never inside a sibling tenant; on MT, paths under
 * `BRAIN_DATA_ROOT` must fall under the read allowlist (your home, ripmail, wiki, indexed roots);
 * paths outside the data root (e.g. `~/Documents/...`) are allowed.
 */
export async function assertManageSourcePathAllowed(rawPath: string): Promise<string> {
  const expanded = expandRawPathToAbsolute(rawPath)
  assertManageSourcePathNotInsideSiblingTenant(expanded)
  const list = await buildReadPathAllowlist()
  if (isAgentReadPathAllowed(expanded, list)) {
    return expanded
  }
  const drPath = dataRoot()
  if (!isPathStrictlyInsideOrEqual(expanded, drPath)) {
    return expanded
  }
  throw new PathEscapeError('path_not_allowed: must be under your workspace or outside the data root')
}
