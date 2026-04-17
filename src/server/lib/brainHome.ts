import { homedir } from 'node:os'
import { join } from 'node:path'
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
    return defaultBundledBrainHome()
  }
  return join(process.cwd(), 'data')
}

function defaultBundledBrainHome(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library/Application Support/Brain')
  }
  return join(homedir(), '.brain')
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

export function calendarCacheDirResolved(): string {
  return brainLayoutCacheDir(brainHome())
}

export function wikiEditsPathResolved(): string {
  return brainLayoutWikiEditsPath(brainHome())
}

export function dirIconsCachePathResolved(): string {
  return brainLayoutDirIconsCachePath(brainHome())
}
