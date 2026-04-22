/**
 * -----------------------------------------------------------------------------
 * ONE-TIME MIGRATION — legacy handle-named dirs → `usr_*` tenant directories
 * -----------------------------------------------------------------------------
 * Historical hosted layout used `BRAIN_DATA_ROOT/<handle>/`. Current layout keys
 * tenants by stable `userId` from `handle-meta.json`: `BRAIN_DATA_ROOT/<usr_…>/`.
 *
 * DELETE THIS ENTIRE FILE and remove its call site from `src/server/index.ts`
 * (`start()`, multi-tenant branch) after production/staging deployments have run
 * successfully and you have confirmed every host has migrated (no legacy dirs left).
 *
 * Safe to run multiple times (idempotent): already-`usr_*` dirs are skipped.
 * -----------------------------------------------------------------------------
 */

import { existsSync } from 'node:fs'
import { readdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { dataRoot } from './dataRoot.js'
import {
  readHandleMeta,
  isValidUserId,
  generateUserId,
  writeHandleMeta,
  handleMetaPath,
  type HandleMetaDoc,
} from './handleMeta.js'
import {
  remapRegistryTenantDirectoryKeys,
  normalizeRegistryAfterTenantDirMigration,
} from './tenantRegistry.js'

/**
 * Strict read failed (missing, invalid, or pre-userId data): recover handle + optional userId from raw JSON, else generate `usr_…` and write `handle-meta.json` before rename.
 */
async function userIdForLegacyDirOrBackfill(legacyPath: string, dirName: string): Promise<string> {
  const ok = await readHandleMeta(legacyPath)
  if (ok) {
    return ok.userId
  }

  let handle = dirName
  let userId: string | undefined
  let confirmedAt: string | null = null

  try {
    const raw = await readFile(handleMetaPath(legacyPath), 'utf-8')
    const j = JSON.parse(raw) as Record<string, unknown>
    if (typeof j.handle === 'string' && j.handle.length > 0) handle = j.handle
    if (typeof j.userId === 'string' && isValidUserId(j.userId)) userId = j.userId
    if (j.confirmedAt === null || j.confirmedAt === undefined) {
      confirmedAt = null
    } else if (typeof j.confirmedAt === 'string') {
      confirmedAt = j.confirmedAt
    }
  } catch {
    // No file, unreadable, or bad JSON: fall through with defaults.
  }

  if (!userId) {
    userId = generateUserId()
  }

  const doc: HandleMetaDoc = { userId, handle, confirmedAt }
  await writeHandleMeta(legacyPath, doc)
  console.error(
    `[brain-app] migrateTenantDirsToUserId: backfilled handle-meta for legacy dir ${JSON.stringify(dirName)} → userId=${userId}`,
  )
  return userId
}

export async function migrateTenantDirsToUserIdOnce(): Promise<void> {
  const root = dataRoot()
  if (!existsSync(root)) return

  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return
  }

  /** Legacy directory name → target `usr_*` id (same as handle-meta.userId). */
  const renamed: Record<string, string> = {}

  for (const name of names) {
    if (name.startsWith('.') || name === 'lost+found') continue
    if (isValidUserId(name)) continue

    const legacyPath = join(root, name)
    const targetName = await userIdForLegacyDirOrBackfill(legacyPath, name)
    const targetPath = join(root, targetName)
    if (legacyPath === targetPath) continue

    if (existsSync(targetPath)) {
      console.error(
        `[brain-app] migrateTenantDirsToUserId: collision — ${targetPath} already exists; not renaming ${legacyPath}`,
      )
      continue
    }

    await rename(legacyPath, targetPath)
    renamed[name] = targetName
    console.error(`[brain-app] migrateTenantDirsToUserId: renamed ${name} → ${targetName}`)
  }

  if (Object.keys(renamed).length > 0) {
    await remapRegistryTenantDirectoryKeys(renamed)
  }
  await normalizeRegistryAfterTenantDirMigration()
}
