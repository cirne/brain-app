import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRepoSharedPath } from './resolveRepoSharedPath.js'

export interface BrainLayout {
  version: number
  directories: {
    wiki: string
    skills: string
    chats: string
    ripmail: string
    cache: string
    var: string
  }
  files: {
    wikiEditsLog: string
    dirIconsCache: string
    vaultVerifier?: string
    vaultSessions?: string
    /** Sidebar RECENTS (docs + email threads), server-backed */
    navRecents?: string
  }
}

let cached: BrainLayout | null = null

/** Resolve `shared/brain-layout.json` (see {@link resolveRepoSharedPath}). */
export function resolveBrainLayoutPath(): string {
  return resolveRepoSharedPath('brain-layout.json')
}

export function getBrainLayout(): BrainLayout {
  if (cached) return cached
  const path = resolveBrainLayoutPath()
  cached = JSON.parse(readFileSync(path, 'utf-8')) as BrainLayout
  return cached
}

export function brainLayoutWikiDir(base: string): string {
  return join(base, getBrainLayout().directories.wiki)
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
