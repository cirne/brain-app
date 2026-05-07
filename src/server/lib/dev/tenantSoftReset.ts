import { unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readdir, rm } from 'node:fs/promises'
import { brainHome, wikiEditsPathResolved } from '@server/lib/platform/brainHome.js'
import {
  brainLayoutChatsDir,
  brainLayoutDirIconsCachePath,
  brainLayoutNavRecentsPath,
  brainLayoutWikiDir,
} from '@server/lib/platform/brainLayout.js'
import { setOnboardingStateForce } from '@server/lib/onboarding/onboardingState.js'
import { ensureWikiVaultScaffold } from '@server/lib/wiki/wikiVaultScaffold.js'
import { deleteWikiSharesForOwner } from '@server/lib/shares/wikiSharesRepo.js'
import { deleteBrainQueryGrantsForTenant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { deleteBrainQueryLogForTenant } from '@server/lib/brainQuery/brainQueryLogRepo.js'
import { wipeWikiContentAt } from '@server/lib/wiki/wikiDir.js'

async function unlinkIgnoreEnoent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code !== 'ENOENT') throw e
  }
}

/** Empty `$tenant/chats` entirely (sessions, onboarding markers, `chats/onboarding/`). */
export async function wipeTenantChatsDir(homeDir: string): Promise<void> {
  const dir = brainLayoutChatsDir(homeDir)
  if (!existsSync(dir)) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    await rm(join(dir, ent.name), { recursive: true, force: true })
  }
}

/**
 * Best-effort removal of wiki edit log, nav recents, dir-icons cache.
 * `wikiEditsPathResolved()` requires tenant ALS (same as `homeDir`).
 */
export async function wipeWikiAdjacentCaches(homeDir: string): Promise<void> {
  await unlinkIgnoreEnoent(wikiEditsPathResolved())
  await unlinkIgnoreEnoent(brainLayoutNavRecentsPath(homeDir))
  await unlinkIgnoreEnoent(brainLayoutDirIconsCachePath(homeDir))
}

async function rmTenantSubtree(homeDir: string, name: string): Promise<void> {
  const p = join(homeDir, name)
  if (!existsSync(p)) return
  await rm(p, { recursive: true, force: true })
}

/**
 * Soft dev reset: mail/vault preserved; wiki + chats + wiki-adjacent caches cleared; starter wiki re-seeded;
 * onboarding forced to guided interview. Caller must establish tenant ALS matching `tenantUserId`'s home.
 */
export async function executeTenantSoftReset(tenantUserId: string): Promise<void> {
  const home = brainHome()
  deleteWikiSharesForOwner(tenantUserId)
  deleteBrainQueryGrantsForTenant(tenantUserId)
  deleteBrainQueryLogForTenant(tenantUserId)

  await wipeWikiContentAt(brainLayoutWikiDir(home))
  await wipeTenantChatsDir(home)
  await wipeWikiAdjacentCaches(home)
  await rmTenantSubtree(home, 'your-wiki')
  await rmTenantSubtree(home, 'background')

  await ensureWikiVaultScaffold(brainLayoutWikiDir(home))
  await setOnboardingStateForce('onboarding-agent')
}
