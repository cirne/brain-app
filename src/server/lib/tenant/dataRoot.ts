import process from 'node:process'
import type { Dirent } from 'node:fs'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
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

/**
 * Dev hard-reset: remove every direct child of `BRAIN_DATA_ROOT` (same idea as `rm -rf ./data/*`).
 * The root directory stays; all tenant trees and `.global/` go. No-op when `BRAIN_DATA_ROOT` is unset
 * (legacy single-home tests).
 */
export async function wipeBrainDataRootContents(): Promise<void> {
  const r = process.env.BRAIN_DATA_ROOT?.trim()
  if (!r || !existsSync(r)) return
  const entries = await readdir(r, { withFileTypes: true })
  for (const ent of entries) {
    await rm(join(r, ent.name), { recursive: true, force: true })
  }
}

/** Tenant data lives under `BRAIN_DATA_ROOT/<tenantUserId>/` where `tenantUserId` is `usr_…`. Display handle lives in `handle-meta.json`. */
export function tenantHomeDir(tenantUserId: string): string {
  return join(dataRoot(), tenantUserId)
}

/**
 * One-time layout: canonical wiki is `wiki/` at tenant root (flat markdown tree).
 * - Legacy `wikis/` → rename to `wiki/` when `wiki/` is absent.
 * - Hoist `wiki/me/*` into `wiki/` (existing top-level names win).
 * - Remove `wiki/@*` share projection dirs.
 * Idempotent.
 */
export function migrateWikiLayoutToFlatWikisRoot(tenantHome: string): void {
  const wikiRoot = join(tenantHome, 'wiki')
  const legacyWikis = join(tenantHome, 'wikis')
  const me = join(wikiRoot, 'me')

  if (!existsSync(wikiRoot)) {
    if (existsSync(legacyWikis)) {
      renameSync(legacyWikis, wikiRoot)
    } else {
      mkdirSync(wikiRoot, { recursive: true })
    }
  } else if (existsSync(legacyWikis)) {
    rmSync(legacyWikis, { recursive: true, force: true })
  }

  if (!existsSync(wikiRoot)) return

  if (existsSync(me)) {
    let ents: Dirent[]
    try {
      ents = readdirSync(me, { withFileTypes: true })
    } catch {
      ents = []
    }
    for (const ent of ents) {
      if (ent.name === '.brain-share-mount') continue
      const from = join(me, ent.name)
      const to = join(wikiRoot, ent.name)
      if (!existsSync(to)) {
        renameSync(from, to)
      } else {
        rmSync(from, { recursive: true, force: true })
      }
    }
    rmSync(me, { recursive: true, force: true })
  }

  let top: Dirent[]
  try {
    top = readdirSync(wikiRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of top) {
    if (ent.isDirectory() && ent.name.startsWith('@')) {
      rmSync(join(wikiRoot, ent.name), { recursive: true, force: true })
    }
  }
}

/** Create tenant tree matching {@link shared/brain-layout.json} under `tenantUserId` (`usr_…`). */
export function ensureTenantHomeDir(tenantUserId: string): string {
  const root = tenantHomeDir(tenantUserId)
  migrateWikiLayoutToFlatWikisRoot(root)
  mkdirSync(brainLayoutSkillsDir(root), { recursive: true })
  mkdirSync(brainLayoutChatsDir(root), { recursive: true })
  mkdirSync(brainLayoutRipmailDir(root), { recursive: true })
  mkdirSync(brainLayoutCacheDir(root), { recursive: true })
  mkdirSync(brainLayoutVarDir(root), { recursive: true })
  mkdirSync(brainLayoutIssuesDir(root), { recursive: true })
  return root
}
