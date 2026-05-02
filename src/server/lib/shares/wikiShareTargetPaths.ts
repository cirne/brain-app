import { join, resolve } from 'node:path'
import { brainLayoutWikiDir, brainLayoutWikisPeerDir } from '@server/lib/platform/brainLayout.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import type { WikiShareRow } from '@server/lib/shares/wikiSharesRepo.js'
import { granteeShareCoversWikiPath } from '@server/lib/shares/wikiSharesRepo.js'

export function ownerWikiRootAbs(ownerId: string): string {
  return resolve(brainLayoutWikiDir(tenantHomeDir(ownerId)))
}

/**
 * Resolved absolute symlink target for an owner's shared subtree or shared file (must remain under owner wiki root).
 */
export function ownerWikiAbsTargetForShare(share: WikiShareRow): string | null {
  const wikiRoot = ownerWikiRootAbs(share.owner_id)
  let relTarget: string
  if (share.target_kind === 'file') {
    relTarget = share.path_prefix.trim().replace(/^\/+/, '')
  } else {
    relTarget = share.path_prefix.trim().replace(/\/+$/, '')
  }
  if (!relTarget || relTarget.includes('..')) return null
  const abs = resolve(join(wikiRoot, relTarget))
  if (abs !== wikiRoot && !abs.startsWith(`${wikiRoot}/`)) return null
  return abs
}

/**
 * Path segments under `wikis/@peer/` for the symlink.
 *
 * For **file shares**: preserves owner's directory structure (e.g. `travel/foo.md` → `['travel', 'foo.md']`).
 * The projection creates parent dirs as regular directories and only the file is a symlink.
 *
 * For **directory shares**: returns the directory path (e.g. `travel/` → `['travel']`).
 * TBD: directory shares may need different handling.
 */
export function peerSymlinkRelSegmentsUnderOwnerShare(share: WikiShareRow): string[] {
  const pre = share.path_prefix.trim().replace(/[/\\]+$/, '').replace(/^[/\\]+/, '').replace(/\\/g, '/')
  return pre ? pre.split('/').filter(Boolean) : []
}

/**
 * POSIX path relative to grantee `wikis/` root (e.g. `@alice/trips/virginia`).
 * @param sanitizedPeerHandleWithAt e.g. `@alice`
 */
export function computePeerLinkPath(sanitizedPeerHandleWithAt: string, share: WikiShareRow): string {
  const h = sanitizedPeerHandleWithAt.trim().replace(/^@+/, '')
  const segs = peerSymlinkRelSegmentsUnderOwnerShare(share)
  return segs.length ? `@${h}/${segs.join('/')}` : `@${h}`
}

/** Absolute path to the symlink file/dir under the grantee tree for this share (path-shaped layout). */
export function granteePeerSymlinkAbsForShare(params: {
  granteeHomeAbs: string
  sanitizedPeerHandleWithAt: string
  share: WikiShareRow
}): string {
  const base = brainLayoutWikisPeerDir(params.granteeHomeAbs, params.sanitizedPeerHandleWithAt)
  const segs = peerSymlinkRelSegmentsUnderOwnerShare(params.share)
  return segs.length ? join(base, ...segs) : base
}

/** Fallback symlink path when path-shaped layout conflicts (`wikis/@peer/<shareId>`). */
export function granteePeerSymlinkAbsFallbackShareId(params: {
  granteeHomeAbs: string
  sanitizedPeerHandleWithAt: string
  share: WikiShareRow
}): string {
  const base = brainLayoutWikisPeerDir(params.granteeHomeAbs, params.sanitizedPeerHandleWithAt)
  return join(base, params.share.id)
}

/** Path suffix under a peer share symlink pointing at owner bytes (POSIX, no leading slashes). */
export function vaultRelInsideShareSymlinkMount(vaultRelPath: string, share: WikiShareRow): string | null {
  const rel = vaultRelPath.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/')
  if (!granteeShareCoversWikiPath(share, rel)) return null
  if (share.target_kind === 'file') return ''
  const root = share.path_prefix.trim().replace(/[/\\]+$/, '').replace(/^[/\\]+/, '')
  const norm = rel.replace(/^[/\\]+/, '')
  if (norm === root) return ''
  const prefixed = `${root}/`
  if (!norm.startsWith(prefixed)) return null
  return norm.slice(prefixed.length)
}

/** Inverse: owner's vault-relative path from under-share suffix. */
export function ownerVaultRelFromShareMountSuffix(share: WikiShareRow, mountSuffixPosix: string): string {
  const sp = mountSuffixPosix.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/')
  if (share.target_kind === 'file') {
    return share.path_prefix.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/')
  }
  const root = share.path_prefix.trim().replace(/[/\\]+$/, '').replace(/^[/\\]+/, '').replace(/\\/g, '/')
  return sp ? `${root}/${sp}` : root
}
