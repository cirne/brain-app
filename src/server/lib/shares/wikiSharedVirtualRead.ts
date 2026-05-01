import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { brainLayoutWikiDir } from '@server/lib/platform/brainLayout.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { getShareForGranteeById, granteeShareCoversWikiPath } from '@server/lib/shares/wikiSharesRepo.js'
import {
  ownerWikiRelPathForVirtualUnderShare,
  parseVirtualSharedWikiPath,
  SHARED_WITH_ME_SEGMENT,
} from '@server/lib/shares/wikiSharedVirtualPath.js'

/**
 * Resolve `Shared with me/...` wiki-relative path to owner wiki file contents for the current grantee.
 */
export async function readGranteeVirtualSharedMarkdown(params: {
  granteeId: string
  virtualRelPath: string
}): Promise<{ text: string } | { error: string }> {
  const coerced = params.virtualRelPath.trim().replace(/\\/g, '/')
  if (!coerced.startsWith(`${SHARED_WITH_ME_SEGMENT}/`)) {
    return { error: 'not_virtual_shared_path' }
  }
  const parsed = parseVirtualSharedWikiPath(coerced)
  if (!parsed) return { error: 'invalid_virtual_path' }
  const share = getShareForGranteeById(parsed.shareId, params.granteeId)
  if (!share) return { error: 'forbidden' }
  const meta = await readHandleMeta(tenantHomeDir(share.owner_id))
  const ownerHandle = meta?.handle ?? share.owner_id
  if (ownerHandle !== parsed.handle) return { error: 'forbidden' }
  const rel = ownerWikiRelPathForVirtualUnderShare(share, parsed.restSegments)
  if (!rel) return { error: 'invalid_virtual_path' }
  if (!rel.endsWith('.md')) return { error: 'not_markdown' }
  if (!granteeShareCoversWikiPath(share, rel)) return { error: 'forbidden' }
  const ownerWiki = resolve(brainLayoutWikiDir(tenantHomeDir(share.owner_id)))
  const full = resolve(join(ownerWiki, rel))
  if (!full.startsWith(ownerWiki + '/') && full !== ownerWiki) return { error: 'forbidden' }
  try {
    const text = await readFile(full, 'utf-8')
    return { text }
  } catch {
    return { error: 'not_found' }
  }
}

export function isVirtualSharedWikiPath(rel: string): boolean {
  const t = rel.trim().replace(/\\/g, '/')
  return t === SHARED_WITH_ME_SEGMENT || t.startsWith(`${SHARED_WITH_ME_SEGMENT}/`)
}
