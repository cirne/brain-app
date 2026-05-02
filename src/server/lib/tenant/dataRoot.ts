import process from 'node:process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  brainLayoutCacheDir,
  brainLayoutChatsDir,
  brainLayoutIssuesDir,
  brainLayoutRipmailDir,
  brainLayoutSkillsDir,
  brainLayoutVarDir,
} from '@server/lib/platform/brainLayout.js'

/**
 * Multi-tenant storage: `BRAIN_DATA_ROOT` points at the mounted volume; each tenant is a subdirectory.
 * Required in all environments (local dev sets it via `npm run dev`).
 */
export function dataRoot(): string {
  const r = process.env.BRAIN_DATA_ROOT?.trim()
  if (!r) {
    throw new Error('BRAIN_DATA_ROOT is not set')
  }
  return r
}

export function globalDir(): string {
  return join(dataRoot(), '.global')
}

/** Tenant data lives under `BRAIN_DATA_ROOT/<tenantUserId>/` where `tenantUserId` is `usr_…`. Display handle lives in `handle-meta.json`. */
export function tenantHomeDir(tenantUserId: string): string {
  return join(dataRoot(), tenantUserId)
}

/**
 * One-time layout: legacy `wiki/` → `wikis/me/`, then remove old `.brain-share-mount/` under me.
 * Idempotent. Does not migrate share projection links (DB reconcile rec creates `wikis/@peer/`).
 */
export function migrateWikiToWikisMe(tenantHome: string): void {
  /** Physical paths only — do not use {@link brainLayoutWikisDir} (test legacy shim may alias `wiki/`). */
  const wikis = join(tenantHome, 'wikis')
  const me = join(wikis, 'me')
  const legacyWiki = join(tenantHome, 'wiki')

  const scrubOldMountUnderMe = () => {
    const oldMount = join(me, '.brain-share-mount')
    if (existsSync(oldMount)) {
      rmSync(oldMount, { recursive: true, force: true })
    }
  }

  if (existsSync(me)) {
    if (existsSync(legacyWiki)) {
      rmSync(legacyWiki, { recursive: true, force: true })
    }
    scrubOldMountUnderMe()
    return
  }

  mkdirSync(wikis, { recursive: true })
  if (existsSync(legacyWiki)) {
    renameSync(legacyWiki, me)
  } else {
    mkdirSync(me, { recursive: true })
  }
  scrubOldMountUnderMe()
}

/** Create tenant tree matching {@link shared/brain-layout.json} under `tenantUserId` (`usr_…`). */
export function ensureTenantHomeDir(tenantUserId: string): string {
  const root = tenantHomeDir(tenantUserId)
  migrateWikiToWikisMe(root)
  mkdirSync(brainLayoutSkillsDir(root), { recursive: true })
  mkdirSync(brainLayoutChatsDir(root), { recursive: true })
  mkdirSync(brainLayoutRipmailDir(root), { recursive: true })
  mkdirSync(brainLayoutCacheDir(root), { recursive: true })
  mkdirSync(brainLayoutVarDir(root), { recursive: true })
  mkdirSync(brainLayoutIssuesDir(root), { recursive: true })
  return root
}
