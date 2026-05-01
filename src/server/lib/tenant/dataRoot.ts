import process from 'node:process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  brainLayoutCacheDir,
  brainLayoutChatsDir,
  brainLayoutIssuesDir,
  brainLayoutRipmailDir,
  brainLayoutSkillsDir,
  brainLayoutVarDir,
  brainLayoutWikiDir,
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

/** Create tenant tree matching {@link shared/brain-layout.json} under `tenantUserId` (`usr_…`). */
export function ensureTenantHomeDir(tenantUserId: string): string {
  const root = tenantHomeDir(tenantUserId)
  mkdirSync(brainLayoutWikiDir(root), { recursive: true })
  mkdirSync(brainLayoutSkillsDir(root), { recursive: true })
  mkdirSync(brainLayoutChatsDir(root), { recursive: true })
  mkdirSync(brainLayoutRipmailDir(root), { recursive: true })
  mkdirSync(brainLayoutCacheDir(root), { recursive: true })
  mkdirSync(brainLayoutVarDir(root), { recursive: true })
  mkdirSync(brainLayoutIssuesDir(root), { recursive: true })
  return root
}
