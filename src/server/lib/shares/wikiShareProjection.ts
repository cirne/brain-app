import { lstat, mkdir, readdir, readlink, rm, stat, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { brainLayoutWikisDir, brainLayoutWikisPeerDir, sanitizeHandleForWikisPeerDir } from '@server/lib/platform/brainLayout.js'
import { migrateWikiToWikisMe, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { listSharesForGrantee, type WikiShareRow } from '@server/lib/shares/wikiSharesRepo.js'
import {
  granteePeerSymlinkAbsFallbackShareId,
  granteePeerSymlinkAbsForShare,
  ownerWikiAbsTargetForShare,
} from '@server/lib/shares/wikiShareTargetPaths.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { logger } from '@server/lib/observability/logger.js'

const log = logger.child({ subsystem: 'wiki-share-projection' })

function symlinkTypeForOs(isDirectory: boolean): 'dir' | 'file' | 'junction' {
  if (process.platform === 'win32') return isDirectory ? 'junction' : 'file'
  return isDirectory ? 'dir' : 'file'
}

async function symlinkPointsToExpected(linkAbs: string, expectedAbs: string): Promise<boolean> {
  try {
    const t = await readlink(linkAbs)
    const canonical = resolve(dirname(linkAbs), t)
    return resolve(canonical) === resolve(expectedAbs)
  } catch {
    return false
  }
}

async function ownerPeerSanitized(ownerId: string): Promise<string | null> {
  const meta = await readHandleMeta(tenantHomeDir(ownerId))
  const raw = (meta?.handle ?? ownerId).trim()
  try {
    return sanitizeHandleForWikisPeerDir(raw)
  } catch (e) {
    log.warn({ ownerId, err: e instanceof Error ? e.message : String(e) }, 'wiki_share_projection_bad_owner_handle')
    return null
  }
}

async function mkdirParentsForLink(peerRootAbs: string, linkAbs: string): Promise<void> {
  const parent = dirname(linkAbs)
  const pr = resolve(peerRootAbs)
  const par = resolve(parent)
  if (par === pr) {
    await mkdir(pr, { recursive: true })
    return
  }
  if (par.startsWith(`${pr}/`)) await mkdir(par, { recursive: true })
  else await mkdir(pr, { recursive: true })
}

async function ensureSymlinkAt(linkAbs: string, targetAbs: string, isDir: boolean): Promise<void> {
  const kind = symlinkTypeForOs(isDir)
  try {
    const cur = await readlink(linkAbs).catch(() => null)
    if (cur !== null) {
      const ok = await symlinkPointsToExpected(linkAbs, targetAbs)
      if (ok) return
      await rm(linkAbs, { recursive: false, force: true })
    } else {
      try {
        await stat(linkAbs)
        await rm(linkAbs, { recursive: true, force: true })
      } catch {
        /* absent */
      }
    }
  } catch {
    /* best-effort clear */
  }
  await symlink(targetAbs, linkAbs, kind)
}

export async function ensureWikiShareSymlinkForRow(params: {
  share: WikiShareRow
  granteeTenantUserId: string
}): Promise<void> {
  const { share, granteeTenantUserId } = params
  if (share.grantee_id !== granteeTenantUserId) return

  const granteeHome = tenantHomeDir(granteeTenantUserId)
  const peer = await ownerPeerSanitized(share.owner_id)
  if (!peer) return

  const targetAbs = ownerWikiAbsTargetForShare(share)
  if (!targetAbs) {
    log.warn({ shareId: share.id }, 'wiki_share_projection_bad_share_target')
    return
  }

  let isDir: boolean
  try {
    const s = await stat(targetAbs)
    isDir = s.isDirectory()
  } catch {
    log.warn({ shareId: share.id, targetAbs }, 'wiki_share_projection_target_missing')
    return
  }

  const peerRootAbs = brainLayoutWikisPeerDir(granteeHome, peer)
  const primaryLink = granteePeerSymlinkAbsForShare({
    granteeHomeAbs: granteeHome,
    sanitizedPeerHandleWithAt: peer,
    share,
  })
  const fallbackLink = granteePeerSymlinkAbsFallbackShareId({
    granteeHomeAbs: granteeHome,
    sanitizedPeerHandleWithAt: peer,
    share,
  })

  await mkdir(peerRootAbs, { recursive: true })
  await mkdirParentsForLink(peerRootAbs, primaryLink)

  try {
    await ensureSymlinkAt(primaryLink, targetAbs, isDir)
    return
  } catch (e) {
    log.warn(
      {
        shareId: share.id,
        primaryLink,
        err: e instanceof Error ? e.message : String(e),
      },
      'wiki_share_projection_primary_symlink_failed_try_fallback',
    )
  }

  await mkdir(dirname(fallbackLink), { recursive: true })
  await ensureSymlinkAt(fallbackLink, targetAbs, isDir)
}

function keeperSetForPeer(peerRootAbs: string, terminalPaths: string[]): Set<string> {
  const keep = new Set<string>()
  const rootR = resolve(peerRootAbs)
  for (const t of terminalPaths) {
    let cur = resolve(t)
    while (true) {
      keep.add(cur)
      const p = dirname(cur)
      if (p === cur || resolve(p) === rootR) {
        keep.add(rootR)
        break
      }
      if (!resolve(p).startsWith(`${rootR}/`)) break
      cur = p
    }
  }
  keep.add(rootR)
  return keep
}

async function prunePeerTree(peerRootAbs: string, keep: Set<string>): Promise<void> {
  const rootR = resolve(peerRootAbs)
  async function walk(abs: string): Promise<void> {
    const absR = resolve(abs)
    if (absR === rootR) {
      const ents = await readdir(abs).catch(() => [])
      for (const name of ents) {
        await walk(join(abs, name))
      }
      return
    }
    if (keep.has(absR)) {
      let st
      try {
        st = await lstat(abs)
      } catch {
        return
      }
      if (st.isDirectory()) {
        const ents = await readdir(abs).catch(() => [])
        for (const name of ents) await walk(join(abs, name))
      }
      return
    }
    await rm(abs, { recursive: true, force: true }).catch(() => {})
  }
  await walk(peerRootAbs)
}

async function resolvedTerminalLinkForShare(
  granteeHome: string,
  peer: string,
  share: WikiShareRow,
): Promise<string | null> {
  const primary = granteePeerSymlinkAbsForShare({
    granteeHomeAbs: granteeHome,
    sanitizedPeerHandleWithAt: peer,
    share,
  })
  const fallback = granteePeerSymlinkAbsFallbackShareId({
    granteeHomeAbs: granteeHome,
    sanitizedPeerHandleWithAt: peer,
    share,
  })
  for (const cand of [primary, fallback]) {
    try {
      await readlink(cand)
      return resolve(cand)
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * Remove projection for one share row (primary path-shaped link or `share.id` fallback).
 * Returns false only if a projection path existed and removal failed.
 */
export async function removeWikiShareProjectionForShare(params: {
  granteeTenantUserId: string
  share: WikiShareRow
}): Promise<boolean> {
  const { granteeTenantUserId, share } = params
  const granteeHome = tenantHomeDir(granteeTenantUserId)
  const peer = await ownerPeerSanitized(share.owner_id)
  if (!peer) return true

  const primaryLink = granteePeerSymlinkAbsForShare({
    granteeHomeAbs: granteeHome,
    sanitizedPeerHandleWithAt: peer,
    share,
  })
  const fallbackLink = granteePeerSymlinkAbsFallbackShareId({
    granteeHomeAbs: granteeHome,
    sanitizedPeerHandleWithAt: peer,
    share,
  })

  let fail = false
  for (const p of [primaryLink, fallbackLink]) {
    try {
      await lstat(p)
    } catch {
      continue
    }
    try {
      await rm(p, { recursive: false, force: true })
    } catch {
      fail = true
    }
  }
  return !fail
}

export async function syncWikiShareProjectionsForGrantee(granteeId: string): Promise<void> {
  migrateWikiToWikisMe(tenantHomeDir(granteeId))
  const shares = listSharesForGrantee(granteeId)
  const granteeHome = tenantHomeDir(granteeId)
  const wikisRoot = brainLayoutWikisDir(granteeHome)
  await mkdir(wikisRoot, { recursive: true })

  const byPeer = new Map<string, WikiShareRow[]>()
  for (const s of shares) {
    const peer = await ownerPeerSanitized(s.owner_id)
    if (!peer) continue
    const list = byPeer.get(peer) ?? []
    list.push(s)
    byPeer.set(peer, list)
  }

  try {
    const top = await readdir(wikisRoot, { withFileTypes: true })
    for (const ent of top) {
      if (!ent.name.startsWith('@')) continue
      const full = join(wikisRoot, ent.name)
      if (!byPeer.has(ent.name)) {
        await rm(full, { recursive: true, force: true }).catch(() => {})
      }
    }
  } catch {
    /* noop */
  }

  for (const s of shares) {
    await ensureWikiShareSymlinkForRow({ share: s, granteeTenantUserId: granteeId }).catch((e) =>
      log.warn({ shareId: s.id, err: e instanceof Error ? e.message : String(e) }, 'wiki_share_projection_sync_row_failed'),
    )
  }

  for (const [peer, peerShares] of byPeer) {
    const peerRootAbs = brainLayoutWikisPeerDir(granteeHome, peer)
    const terminals: string[] = []
    for (const s of peerShares) {
      const t = await resolvedTerminalLinkForShare(granteeHome, peer, s)
      if (t) terminals.push(t)
    }
    if (terminals.length === 0) {
      await rm(peerRootAbs, { recursive: true, force: true }).catch(() => {})
    } else {
      const keep = keeperSetForPeer(peerRootAbs, terminals)
      await prunePeerTree(peerRootAbs, keep)
    }
  }
}
