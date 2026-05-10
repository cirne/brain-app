import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import type { CreateNotificationInput, NotificationRow } from './notificationsRepo.js'
import { createNotification } from './notificationsRepo.js'

/**
 * Insert a notification row for another tenant (recipient `tenantUserId`).
 * Used when the HTTP session is the actor but the recipient differs (e.g. brain-query grant to collaborator).
 */
export async function createNotificationForTenant(
  tenantUserId: string,
  input: CreateNotificationInput,
): Promise<NotificationRow> {
  const homeDir = tenantHomeDir(tenantUserId.trim())
  const meta = await readHandleMeta(homeDir)
  const workspaceHandle =
    meta && typeof meta.confirmedAt === 'string' && meta.confirmedAt.length > 0 ? meta.handle : tenantUserId
  return runWithTenantContextAsync(
    { tenantUserId: tenantUserId.trim(), workspaceHandle, homeDir },
    async () => createNotification(input),
  )
}
