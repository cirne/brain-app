import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRepoSharedPath } from './resolveRepoSharedPath.js'

export interface BrainLayout {
  version: number
  directories: {
    /** Personal markdown wiki root: `wiki/` */
    wiki: string
    skills: string
    chats: string
    ripmail: string
    cache: string
    var: string
    /** Wiki-only ZIP snapshot history directory (see docs/architecture/backup-restore.md). */
    wikiBackups: string
    issues: string
  }
  files: {
    /** Unified per-tenant app SQLite (chat, notifications; ripmail merge → OPP-108). */
    tenantSqlite: string
    wikiEditsLog: string
    dirIconsCache: string
    issuesCounter: string
    vaultVerifier?: string
    vaultSessions?: string
    /** Sidebar RECENTS (docs + email threads), server-backed */
    navRecents?: string
  }
}

/** Legacy `wikis/` dir in tests before `wiki/` exists (NODE_ENV=test only). */
function useLegacyWikiLayoutInTest(tenantHome: string): boolean {
  const wiki = join(tenantHome, 'wiki')
  const wikis = join(tenantHome, 'wikis')
  return process.env.NODE_ENV === 'test' && existsSync(wikis) && !existsSync(wiki)
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
  const w = getBrainLayout().directories.wiki?.trim().replace(/^\/+|\/+$/g, '') || 'wiki'
  return w
}

/** Tenant wiki markdown root (`wiki/`), shared by UI/API and agent tools. */
export function brainLayoutWikisDir(base: string): string {
  if (useLegacyWikiLayoutInTest(base)) return join(base, 'wikis')
  return join(base, brainLayoutWikisSegment())
}

/** @deprecated Alias of {@link brainLayoutWikisDir}; wiki lives directly under `wiki/`. */
export function brainLayoutWikiDir(base: string): string {
  return brainLayoutWikisDir(base)
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

/** Directory for retention-limited wiki-only backup ZIPs (`var/wiki-backups/` by default). */
export function brainLayoutWikiBackupsDir(base: string): string {
  return join(base, getBrainLayout().directories.wikiBackups)
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

/** Per-tenant SQLite (chat, notifications; single schema version). Under `<tenant>/var/`. */
export function brainLayoutTenantSqlitePath(base: string): string {
  const L = getBrainLayout()
  const name = L.files.tenantSqlite ?? 'brain-tenant.sqlite'
  return join(base, L.directories.var, name)
}
