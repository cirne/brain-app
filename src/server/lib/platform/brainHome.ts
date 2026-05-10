import process from 'node:process'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { getStandardBrainLlm } from '@server/lib/llm/effectiveBrainLlm.js'
import {
  brainLayoutChatsDir,
  brainLayoutDirIconsCachePath,
  brainLayoutRipmailDir,
  brainLayoutSkillsDir,
  brainLayoutWikiEditsPath,
  brainLayoutWikisDir,
} from './brainLayout.js'

/**
 * Local durable root for the current request (tenant home from AsyncLocalStorage).
 * Wiki filesystem may be rooted at {@link brainWikiParentRoot} when `BRAIN_WIKI_ROOT` is set (wiki eval).
 */
export function brainHome(): string {
  const ctx = tryGetTenantContext()
  if (ctx) return ctx.homeDir
  /** Legacy unit tests set `BRAIN_HOME` to an isolated tmp dir without tenant ALS (pre MT-only tree). */
  if (process.env.NODE_ENV === 'test') {
    const legacy = process.env.BRAIN_HOME?.trim()
    if (legacy) return legacy
  }
  throw new Error('tenant_context_required')
}

/**
 * Parent directory for wiki layout (`wiki/`): normal tenant home, or **`BRAIN_WIKI_ROOT`**
 * when set (JSONL wiki eval — isolated vault while ripmail stays under {@link brainHome}).
 */
export function brainWikiParentRoot(): string {
  const alt = process.env.BRAIN_WIKI_ROOT?.trim()
  if (alt) return resolve(alt)
  return brainHome()
}

/**
 * Wipe: remove every top-level file and directory under the tenant home (no layout list).
 */
export async function wipeBrainHomeContents(): Promise<void> {
  const home = brainHome()
  const { evictTenantDbForHome } = await import('@server/lib/tenant/tenantSqlite.js')
  evictTenantDbForHome(home)
  if (existsSync(home)) {
    const entries = await readdir(home, { withFileTypes: true })
    for (const ent of entries) {
      await rm(join(home, ent.name), { recursive: true, force: true })
    }
  }
}

export function wikiContentDir(): string {
  return brainLayoutWikisDir(brainWikiParentRoot())
}

/** Same as {@link wikiContentDir} — single markdown root under `wiki/`. */
export function wikiToolsRootDir(): string {
  return brainLayoutWikisDir(brainWikiParentRoot())
}

export function skillsDataDir(): string {
  return brainLayoutSkillsDir(brainHome())
}

export function chatDataDirResolved(): string {
  return brainLayoutChatsDir(brainHome())
}

/** Ripmail config + SQLite root under Brain: tenant `<layout ripmail>/` only (never reads `RIPMAIL_HOME`). */
export function ripmailHomeForBrain(): string {
  return brainLayoutRipmailDir(brainHome())
}

/** Env for every `ripmail` subprocess so CLI resolves the same store as Brain. */
export function ripmailProcessEnv(): typeof process.env {
  const out = { ...process.env, RIPMAIL_HOME: ripmailHomeForBrain() } as typeof process.env
  const gid = out.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID?.trim()
  const gsec = out.RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const brid = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const bsec = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!gid && brid) out.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID = brid
  if (!gsec && bsec) out.RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET = bsec
  if (!out.RIPMAIL_LLM_PROVIDER?.trim()) {
    try {
      out.RIPMAIL_LLM_PROVIDER = getStandardBrainLlm().provider.toLowerCase()
    } catch {
      out.RIPMAIL_LLM_PROVIDER = 'openai'
    }
  }
  const tenantCtx = tryGetTenantContext()
  if (tenantCtx) {
    out.BRAIN_TENANT_USER_ID = tenantCtx.tenantUserId
    out.BRAIN_WORKSPACE_HANDLE = tenantCtx.workspaceHandle
  }
  return out
}

export function wikiEditsPathResolved(): string {
  return brainLayoutWikiEditsPath(brainHome())
}

export function dirIconsCachePathResolved(): string {
  return brainLayoutDirIconsCachePath(brainHome())
}
