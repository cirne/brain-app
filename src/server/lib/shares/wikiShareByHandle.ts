import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { listSharesForGrantee } from '@server/lib/shares/wikiSharesRepo.js'

/** Strip URL `@` prefix for comparison with stored handles. */
export function normalizeWikiShareHandleParam(raw: string): string {
  let h = raw.trim()
  if (h.startsWith('@')) h = h.slice(1)
  return h.trim()
}

/**
 * Resolve owner tenant id for an accepted share visible to the grantee whose workspace handle
 * (handle-meta or fallback owner id) matches `handle`.
 */
export async function resolveShareOwnerIdForGranteeHandle(params: {
  granteeId: string
  handle: string
}): Promise<string | null> {
  const wanted = normalizeWikiShareHandleParam(params.handle)
  if (!wanted) return null
  const rows = listSharesForGrantee(params.granteeId)
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))]
  for (const oid of ownerIds) {
    const meta = await readHandleMeta(tenantHomeDir(oid))
    const label = (meta?.handle ?? oid).trim()
    if (label === wanted || oid === wanted) return oid
  }
  return null
}
