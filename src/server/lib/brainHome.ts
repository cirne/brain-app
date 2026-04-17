import process from 'node:process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { defaultBundledBrainHomeRoot } from './bundleDefaults.js'
import {
  brainLayoutCacheDir,
  brainLayoutChatsDir,
  brainLayoutDirIconsCachePath,
  brainLayoutRipmailDir,
  brainLayoutSkillsDir,
  brainLayoutWikiDir,
  brainLayoutWikiEditsPath,
} from './brainLayout.js'

/**
 * Single root for durable Brain data. Set by Tauri when bundled; in dev defaults to ./data.
 * Optional override: standalone ripmail uses RIPMAIL_HOME only (see ripmail docs).
 */
export function brainHome(): string {
  const e = process.env.BRAIN_HOME
  if (e) return e
  if (process.env.BRAIN_BUNDLED_NATIVE === '1') {
    return defaultBundledBrainHomeRoot()
  }
  return join(process.cwd(), 'data')
}

/**
 * Dev hard-reset: remove every top-level file and directory under `BRAIN_HOME` (no layout list).
 * The root directory itself is kept; callers recreate paths on demand.
 */
export async function wipeBrainHomeContents(): Promise<void> {
  const home = brainHome()
  if (!existsSync(home)) return
  const entries = await readdir(home, { withFileTypes: true })
  for (const ent of entries) {
    await rm(join(home, ent.name), { recursive: true, force: true })
  }
}

export function wikiContentDir(): string {
  return brainLayoutWikiDir(brainHome())
}

export function skillsDataDir(): string {
  return brainLayoutSkillsDir(brainHome())
}

export function chatDataDirResolved(): string {
  return brainLayoutChatsDir(brainHome())
}

/** Ripmail home when running under Brain (subprocess env). Honors RIPMAIL_HOME override. */
export function ripmailHomeForBrain(): string {
  if (process.env.RIPMAIL_HOME) return process.env.RIPMAIL_HOME
  return brainLayoutRipmailDir(brainHome())
}

/** Env for every `ripmail` subprocess so CLI resolves the same store as Brain (`data/ripmail` in dev). */
export function ripmailProcessEnv(): typeof process.env {
  const out = { ...process.env, RIPMAIL_HOME: ripmailHomeForBrain() } as typeof process.env
  // Brain Gmail OAuth uses GOOGLE_OAUTH_*; ripmail refresh uses RIPMAIL_GOOGLE_OAUTH_* — align when only Brain vars are set.
  const gid = out.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID?.trim()
  const gsec = out.RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const brid = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const bsec = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!gid && brid) out.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID = brid
  if (!gsec && bsec) out.RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET = bsec
  return out
}

export function calendarCacheDirResolved(): string {
  return brainLayoutCacheDir(brainHome())
}

export function wikiEditsPathResolved(): string {
  return brainLayoutWikiEditsPath(brainHome())
}

export function dirIconsCachePathResolved(): string {
  return brainLayoutDirIconsCachePath(brainHome())
}
