import { isBraintunnelMailSubject } from '@shared/braintunnelMailMarker.js'
import type { Draft } from '@server/ripmail/types.js'
import { extractPrimaryEmailFromRipmailFromField } from '@server/lib/notifications/syncMailNotifyNotifications.js'
import { getActiveBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { createNotificationForTenant } from '@server/lib/notifications/createNotificationForTenant.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { resolveUserIdByPrimaryEmail } from '@server/lib/tenant/workspaceHandleDirectory.js'

function normalizedRecipientsFromDraft(draft: Draft): string[] {
  const raw = [...(draft.to ?? []), ...(draft.cc ?? [])].map((r) => r.trim()).filter(Boolean)
  const set = new Set<string>()
  for (const row of raw) {
    const e = extractPrimaryEmailFromRipmailFromField(row || null)
    if (e) set.add(e)
  }
  return [...set].sort()
}

/**
 * After an owner sends Braintunnel collaborator outbound mail (`[braintunnel]` subject), notify the
 * grant asker immediately so they can refresh and read inbound mail once IMAP indexing catches up.
 */
export async function notifyAskerBrainQueryReplySent(ownerId: string, draft: Draft): Promise<boolean> {
  const owner = ownerId.trim()
  if (!owner.length) return false
  if (!isBraintunnelMailSubject(draft.subject)) return false

  for (const email of normalizedRecipientsFromDraft(draft)) {
    const askerId = await resolveUserIdByPrimaryEmail({ email })
    if (!askerId?.trim()) continue
    const grant = getActiveBrainQueryGrant({ ownerId: owner, askerId: askerId.trim() })
    if (!grant) continue

    let peerHandle: string | undefined
    const meta = await readHandleMeta(tenantHomeDir(owner))
    const h =
      meta && typeof meta.confirmedAt === 'string' && meta.confirmedAt.length > 0
        ? typeof meta.handle === 'string'
          ? meta.handle.trim().replace(/^@/, '')
          : ''
        : ''
    if (h) peerHandle = h

    const payload: Record<string, unknown> = {
      grantId: grant.id,
      peerUserId: owner,
      subject: draft.subject,
    }
    if (peerHandle) payload.peerHandle = peerHandle

    await createNotificationForTenant(askerId.trim(), {
      sourceKind: 'brain_query_reply_sent',
      idempotencyKey: `brain_query_reply_sent:${draft.id}`,
      payload,
    })
    return true
  }
  return false
}
