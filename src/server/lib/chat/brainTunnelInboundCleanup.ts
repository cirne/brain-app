import { deleteSession } from '@server/agent/index.js'
import type { BrainQueryGrantRow } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import {
  deleteB2bInboundQueryNotificationsForGrantId,
  deleteNotificationsForB2bInboundSessionId,
} from '@server/lib/notifications/notificationsRepo.js'
import { notifyBrainTunnelActivity } from '@server/lib/hub/hubSseBroker.js'
import { ensureTenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync, type TenantContext } from '@server/lib/tenant/tenantContext.js'
import { deleteSessionFile, listInboundSessionIdsForRemoteGrant } from './chatStorage.js'

async function tenantContextForUser(userId: string): Promise<TenantContext> {
  const homeDir = ensureTenantHomeDir(userId)
  const meta = await readHandleMeta(homeDir)
  return {
    tenantUserId: userId,
    workspaceHandle: meta?.handle ?? userId,
    homeDir,
  }
}

/** On the Brain tunnel owner's tenant: inbound review rows + grant-keyed notifications for this grant. */
export async function deleteOwnerInboundForRevokedBrainQueryGrant(grant: BrainQueryGrantRow): Promise<void> {
  const ownerCtx = await tenantContextForUser(grant.owner_id)
  await runWithTenantContextAsync(ownerCtx, async () => {
    const ids = listInboundSessionIdsForRemoteGrant(grant.id)
    for (const sid of ids) {
      deleteNotificationsForB2bInboundSessionId(sid)
      deleteSession(sid)
      await deleteSessionFile(sid)
    }
    deleteB2bInboundQueryNotificationsForGrantId(grant.id)
    await notifyBrainTunnelActivity(
      JSON.stringify({
        scope: 'inbox',
        grantId: grant.id,
        inboundSessionId: null,
      }),
    )
  })
}
