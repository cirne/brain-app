import process from 'node:process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { defaultBundledBrainHomeRoot, defaultBundledWikiParentRoot } from './bundleDefaults.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import {
  brainLayoutChatsDir,
  brainLayoutDirIconsCachePath,
  brainLayoutRipmailDir,
  brainLayoutSkillsDir,
  brainLayoutWikiDir,
  brainLayoutWikiEditsPath,
} from './brainLayout.js'

/** Same on-disk directory as {@link brainHome} when no request tenant context is set (single-tenant only). */
export function resolveBrainHomeDiskRoot(): string {
  const e = process.env.BRAIN_HOME
  if (e) return e
  if (process.env.BRAIN_BUNDLED_NATIVE === '1') {
    return defaultBundledBrainHomeRoot()
  }
  return join(process.cwd(), 'data')
}

/**
 * Local durable root (Application Support on bundled macOS; `./data` in dev).
 * Wiki markdown may live under {@link brainWikiParentRoot} when the layout is split (OPP-024).
 *
 * With `BRAIN_DATA_ROOT` (multi-tenant), returns the current request's tenant home from
 * AsyncLocalStorage; callers outside a request must use {@link resolveBrainHomeDiskRoot} only
 * when not in multi-tenant mode.
 */
export function brainHome(): string {
  const ctx = tryGetTenantContext()
  if (ctx) return ctx.homeDir
  if (isMultiTenantMode()) {
    throw new Error('tenant_context_required')
  }
  return resolveBrainHomeDiskRoot()
}

/**
 * Parent directory of the `wiki/` segment (`$BRAIN_WIKI_ROOT/wiki`).
 * Bundled macOS defaults to `~/Documents/Brain`; dev and non-macOS use `brainHome()`.
 */
export function brainWikiParentRoot(): string {
  if (isMultiTenantMode()) {
    return brainHome()
  }
  if (process.env.BRAIN_WIKI_ROOT) {
    return process.env.BRAIN_WIKI_ROOT
  }
  if (process.env.BRAIN_BUNDLED_NATIVE === '1' && process.platform === 'darwin') {
    return defaultBundledWikiParentRoot()
  }
  return brainHome()
}

/**
 * Dev hard-reset: remove every top-level file and directory under `BRAIN_HOME` (no layout list).
 * When wiki lives outside `BRAIN_HOME` (bundled macOS), also removes `$BRAIN_WIKI_ROOT/wiki`.
 * The root directory itself is kept; callers recreate paths on demand.
 */
export async function wipeBrainHomeContents(): Promise<void> {
  const home = brainHome()
  const wiki = wikiContentDir()
  const wikiParent = brainWikiParentRoot()
  if (existsSync(home)) {
    const entries = await readdir(home, { withFileTypes: true })
    for (const ent of entries) {
      await rm(join(home, ent.name), { recursive: true, force: true })
    }
  }
  if (wikiParent !== home && existsSync(wiki)) {
    await rm(wiki, { recursive: true, force: true })
  }
}

export function wikiContentDir(): string {
  return brainLayoutWikiDir(brainWikiParentRoot())
}

export function skillsDataDir(): string {
  return brainLayoutSkillsDir(brainHome())
}

export function chatDataDirResolved(): string {
  return brainLayoutChatsDir(brainHome())
}

/** Ripmail config + SQLite root under Brain: `$BRAIN_HOME/<layout ripmail>/` only (never reads `RIPMAIL_HOME`). */
export function ripmailHomeForBrain(): string {
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
  // Brain chat uses `LLM_PROVIDER` (defaults to openai in TS); ripmail only reads
  // `RIPMAIL_LLM_PROVIDER` / config.json. Align subprocess env so draft/ask use the same keys.
  if (!out.RIPMAIL_LLM_PROVIDER?.trim()) {
    const fromBrain = process.env.LLM_PROVIDER?.trim().toLowerCase()
    out.RIPMAIL_LLM_PROVIDER = fromBrain && fromBrain.length > 0 ? fromBrain : 'openai'
  }
  return out
}

export function wikiEditsPathResolved(): string {
  return brainLayoutWikiEditsPath(brainHome())
}

export function dirIconsCachePathResolved(): string {
  return brainLayoutDirIconsCachePath(brainHome())
}
