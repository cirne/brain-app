import type { WikiShareRow } from '@server/lib/shares/wikiSharesRepo.js'

/** Matches client {@link SHARED_WITH_ME_SEGMENT}. */
export const SHARED_WITH_ME_SEGMENT = 'Shared with me'

export type ParsedVirtualSharedPath = {
  handle: string
  shareId: string
  /** Path under the share root (vault-relative, using `/`). */
  restSegments: string[]
}

/** `Shared with me/{handle}/{shareId}/...` → parts or null if not in this namespace. */
export function parseVirtualSharedWikiPath(rel: string): ParsedVirtualSharedPath | null {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 3 || parts[0] !== SHARED_WITH_ME_SEGMENT) return null
  return {
    handle: parts[1]!,
    shareId: parts[2]!,
    restSegments: parts.slice(3),
  }
}

/**
 * Map a virtual path under a resolved share row to an owner wiki-relative path.
 * Returns `null` for directory share root (use list API with prefix instead of a single file).
 */
export function ownerWikiRelPathForVirtualUnderShare(share: WikiShareRow, restSegments: string[]): string | null {
  if (share.target_kind === 'file') {
    if (restSegments.length > 0) return null
    return share.path_prefix
  }
  const root = share.path_prefix.replace(/\/$/, '')
  if (restSegments.length === 0) return null
  return `${root}/${restSegments.join('/')}`
}
