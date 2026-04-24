import process from 'node:process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  brainLayoutCacheDir,
  brainLayoutChatsDir,
  brainLayoutIssuesDir,
  brainLayoutRipmailDir,
  brainLayoutSkillsDir,
  brainLayoutVarDir,
  brainLayoutVaultVerifierPath,
  brainLayoutWikiDir,
} from './brainLayout.js'

/**
 * Multi-tenant mode: `BRAIN_DATA_ROOT` points at the mounted volume; each tenant is a subdirectory.
 * When unset, single-tenant mode uses `BRAIN_HOME` / bundled defaults / `./data`.
 */
export function isMultiTenantMode(): boolean {
  const r = process.env.BRAIN_DATA_ROOT?.trim()
  return typeof r === 'string' && r.length > 0
}

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

/** True if this tenant directory already has a vault verifier on disk (setup collision). */
export function tenantVaultVerifierExistsSync(tenantUserId: string): boolean {
  return existsSync(brainLayoutVaultVerifierPath(tenantHomeDir(tenantUserId)))
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

/**
 * True if any tenant directory under the data root contains a vault verifier (not including `.global`).
 */
export function anyTenantVaultVerifierExistsSync(): boolean {
  if (!isMultiTenantMode()) return false
  const dr = process.env.BRAIN_DATA_ROOT?.trim()
  if (!dr || !existsSync(dr)) return false
  let names: string[]
  try {
    names = readdirSync(dr)
  } catch {
    return false
  }
  for (const name of names) {
    if (name.startsWith('.') || name === 'lost+found') continue
    const home = join(dr, name)
    if (existsSync(brainLayoutVaultVerifierPath(home))) {
      return true
    }
  }
  return false
}
