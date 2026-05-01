import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { listSharesForGrantee, listSharesForOwner } from './wikiSharesRepo.js'

/**
 * Share rows are stored in the global `brain-global.sqlite` (see `getBrainGlobalDb`) but are always
 * scoped by `owner_id` / `grantee_id` to specific tenants — not world-readable.
 *
 * Colocating `shares` on `GET /api/wiki` lets the wiki file browser use **one** round trip for
 * listing plus outgoing/incoming share hints. `GET /api/wiki-shares` remains the canonical place for
 * **mutations** (POST invite, DELETE revoke) and for consumers that only need share rows without
 * walking the vault file list.
 */
export type WikiListShareOwned = { pathPrefix: string; targetKind: 'dir' | 'file' }
export type WikiListShareReceived = {
  id: string
  ownerId: string
  ownerHandle: string
  pathPrefix: string
  targetKind: 'dir' | 'file'
}

export async function buildWikiListShareEnvelope(tenantUserId: string): Promise<{
  owned: WikiListShareOwned[]
  received: WikiListShareReceived[]
}> {
  const ownedRows = listSharesForOwner(tenantUserId)
  const owned: WikiListShareOwned[] = ownedRows.map((r) => ({
    pathPrefix: r.path_prefix,
    targetKind: r.target_kind === 'file' ? 'file' : 'dir',
  }))

  const receivedRows = listSharesForGrantee(tenantUserId)
  const received: WikiListShareReceived[] = await Promise.all(
    receivedRows.map(async (r) => {
      const meta = await readHandleMeta(tenantHomeDir(r.owner_id))
      return {
        id: r.id,
        ownerId: r.owner_id,
        ownerHandle: meta?.handle ?? r.owner_id,
        pathPrefix: r.path_prefix,
        targetKind: r.target_kind === 'file' ? 'file' : 'dir',
      }
    }),
  )

  return { owned, received }
}
