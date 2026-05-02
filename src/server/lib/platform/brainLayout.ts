import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRepoSharedPath } from './resolveRepoSharedPath.js'

export interface BrainLayout {
  version: number
  directories: {
    /** Unified wiki namespace root: `wikis/` (personal `me/` + peers `@handle/`) — OPP-091 */
    wikis: string
    skills: string
    chats: string
    ripmail: string
    cache: string
    var: string
    issues: string
  }
  files: {
    wikiEditsLog: string
    dirIconsCache: string
    issuesCounter: string
    vaultVerifier?: string
    vaultSessions?: string
    /** Sidebar RECENTS (docs + email threads), server-backed */
    navRecents?: string
  }
}

/** Reserved segment under `wikis/` for the signed-in user's vault (not a share peer name). */
export const WIKIS_ME_SEGMENT = 'me'

/** Handle slug `me` is reserved — cannot name a peer `@me` (collides with personal vault). */
export const ME_RESERVED_HANDLE = 'me'

/** Legacy single `wiki/` dir in tests before `wikis/` exists (NODE_ENV=test only). */
function useLegacyWikiLayoutInTest(tenantHome: string): boolean {
  const wikis = join(tenantHome, 'wikis')
  return process.env.NODE_ENV === 'test' && existsSync(join(tenantHome, 'wiki')) && !existsSync(wikis)
}

/** Resolve `shared/brain-layout.json` (see {@link resolveRepoSharedPath}). */
export function resolveBrainLayoutPath(): string {
  return resolveRepoSharedPath('brain-layout.json')
}

let cached: BrainLayout | null = null

export function getBrainLayout(): BrainLayout {
  if (cached) return cached
  const path = resolveBrainLayoutPath()
  cached = JSON.parse(readFileSync(path, 'utf-8')) as BrainLayout
  return cached
}

export function brainLayoutWikisSegment(): string {
  const w = getBrainLayout().directories.wikis?.trim().replace(/^\/+|\/+$/g, '') || 'wikis'
  return w
}

/** Tenant `wikis/` — agent tool root and parent of `me/` + `@peer/`. */
export function brainLayoutWikisDir(base: string): string {
  if (useLegacyWikiLayoutInTest(base)) return join(base, 'wiki')
  return join(base, brainLayoutWikisSegment())
}

/** Personal vault markdown root: `wikis/me/`. */
export function brainLayoutWikisMeDir(base: string): string {
  if (useLegacyWikiLayoutInTest(base)) return join(base, 'wiki')
  return join(brainLayoutWikisDir(base), WIKIS_ME_SEGMENT)
}

/**
 * @deprecated Legacy name — personal vault only (`wikis/me/`). Prefer {@link brainLayoutWikisMeDir}.
 */
export function brainLayoutWikiDir(base: string): string {
  return brainLayoutWikisMeDir(base)
}

/**
 * Sanitize owner/workspace handle to a single path segment `@slug` under `wikis/`.
 * @throws If empty after trim, reserved `me`, or unusable after sanitization.
 */
export function sanitizeHandleForWikisPeerDir(handle: string): string {
  const t = handle.trim().replace(/^@+/, '').toLowerCase()
  if (!t) throw new Error('wiki_peer_handle_empty')
  if (t === ME_RESERVED_HANDLE) throw new Error('wiki_peer_handle_reserved_me')
  const slug = t.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) throw new Error('wiki_peer_handle_unusable')
  return `@${slug}`
}

/** Absolute `wikis/@peer/` for an already-sanitized handle (must start with `@`). */
export function brainLayoutWikisPeerDir(base: string, sanitizedHandleWithAt: string): string {
  const raw = sanitizedHandleWithAt.trim()
  const seg = raw.startsWith('@') ? raw : `@${raw}`
  return join(brainLayoutWikisDir(base), seg)
}

export function brainLayoutSkillsDir(base: string): string {
  return join(base, getBrainLayout().directories.skills)
}

export function brainLayoutChatsDir(base: string): string {
  return join(base, getBrainLayout().directories.chats)
}

export function brainLayoutRipmailDir(base: string): string {
  return join(base, getBrainLayout().directories.ripmail)
}

export function brainLayoutCacheDir(base: string): string {
  return join(base, getBrainLayout().directories.cache)
}

export function brainLayoutVarDir(base: string): string {
  return join(base, getBrainLayout().directories.var)
}

export function brainLayoutIssuesDir(base: string): string {
  return join(base, getBrainLayout().directories.issues)
}

export function brainLayoutIssuesCounterPath(base: string): string {
  const L = getBrainLayout()
  const name = L.files.issuesCounter ?? 'issues-counter.json'
  return join(base, L.directories.var, name)
}

export function brainLayoutWikiEditsPath(base: string): string {
  const L = getBrainLayout()
  return join(base, L.directories.var, L.files.wikiEditsLog)
}

export function brainLayoutDirIconsCachePath(base: string): string {
  const L = getBrainLayout()
  return join(base, L.directories.cache, L.files.dirIconsCache)
}

export function brainLayoutVaultVerifierPath(base: string): string {
  const L = getBrainLayout()
  const name = L.files.vaultVerifier ?? 'vault-verifier.json'
  return join(base, L.directories.var, name)
}

export function brainLayoutVaultSessionsPath(base: string): string {
  const L = getBrainLayout()
  const name = L.files.vaultSessions ?? 'vault-sessions.json'
  return join(base, L.directories.var, name)
}

export function brainLayoutNavRecentsPath(base: string): string {
  const L = getBrainLayout()
  const name = L.files.navRecents ?? 'nav-recents.json'
  return join(base, L.directories.var, name)
}
