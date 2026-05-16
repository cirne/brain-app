import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from '@earendil-works/pi-ai'
import { assertOptionalBrainQueryGrantId } from '@shared/braintunnelMailMarker.js'
import {
  getActiveBrainQueryGrant,
  getBrainQueryGrantById,
} from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { createNotificationForTenant } from '@server/lib/notifications/createNotificationForTenant.js'
import { readHandleMeta, isValidUserId } from '@server/lib/tenant/handleMeta.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import {
  getPrimaryEmailForUserId,
  resolveConfirmedHandle,
} from '@server/lib/tenant/workspaceHandleDirectory.js'
import {
  InvalidWorkspaceHandleError,
  parseWorkspaceHandle,
} from '@server/lib/tenant/workspaceHandle.js'

function summarySubjectFromQuestion(question: string): string {
  const oneLine = question.trim().replace(/\s+/g, ' ')
  const max = 100
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max)}…`
}

/**
 * Grant-scoped outbound question: inserts a notification on the grant owner's tenant (no outbound mail).
 * Only for tenants who are the **asker** on the grant. Replies still go through collaborator mail from the owner.
 */
export function createAskCollaboratorTool() {
  return defineTool({
    name: 'ask_collaborator',
    label: 'Ask Brain',
    description:
      'Legacy Ask Brain notification tool. Prefer the chat-native Tunnels UI for new brain-to-brain questions. Use this only when the user explicitly asks this assistant to notify a collaborator from chat instead of opening a tunnel. Pass either `grant_id` (`bqg_…`) or `peer_handle` (`@their-name`) — the server resolves the active grant at send time.',
    parameters: Type.Object({
      grant_id: Type.Optional(
        Type.String({
          description:
            'Brain-query grant id (`bqg_…`) where the current user is the asker. Omit when passing peer_handle or peer_user_id.',
        }),
      ),
      peer_handle: Type.Optional(
        Type.String({
          description:
            'Their confirmed workspace handle (`cirne` or `@cirne`). Use when the user @mentions who to ask and grant_id is unknown.',
        }),
      ),
      peer_user_id: Type.Optional(
        Type.String({
          description:
            'Opaque collaborator tenant id (`usr_…`) when known; otherwise prefer peer_handle. Must have an active grant from them to this workspace.',
        }),
      ),
      question: Type.String({
        description: 'Natural-language question or message for the other workspace.',
      }),
    }),
    async execute(
      _toolCallId: string,
      params: { grant_id?: string; peer_handle?: string; peer_user_id?: string; question: string },
    ) {
      const ctx = tryGetTenantContext()
      if (!ctx?.tenantUserId?.trim()) {
        throw new Error('ask_collaborator requires an authenticated workspace session.')
      }
      const tenantId = ctx.tenantUserId.trim()

      const resolveGrant = async (): Promise<ReturnType<typeof getBrainQueryGrantById>> => {
        const gid = params.grant_id?.trim()
        if (gid) {
          assertOptionalBrainQueryGrantId(gid)
          return getBrainQueryGrantById(gid)
        }
        const peerUid = params.peer_user_id?.trim()
        if (peerUid) {
          if (!isValidUserId(peerUid)) {
            throw new Error('peer_user_id must be a valid workspace tenant id (usr_…).')
          }
          if (peerUid === tenantId) {
            throw new Error('Cannot send an Ask Brain question to your own workspace.')
          }
          const g = getActiveBrainQueryGrant({ ownerId: peerUid, askerId: tenantId })
          if (!g) {
            throw new Error(
              'No active Ask Brain connection from that workspace to yours — they may need to grant access again.',
            )
          }
          return g
        }
        const rawHandle = params.peer_handle?.trim()
        if (!rawHandle) {
          throw new Error(
            'Provide grant_id, peer_handle (@their workspace name), or peer_user_id so Ask Brain knows whom to reach.',
          )
        }
        let normalized: string
        try {
          normalized = parseWorkspaceHandle(rawHandle)
        } catch (e) {
          const msg = e instanceof InvalidWorkspaceHandleError ? e.message : 'Invalid peer_handle.'
          throw new Error(msg, { cause: e })
        }
        const entry = await resolveConfirmedHandle({
          handle: normalized,
          excludeUserId: tenantId,
        })
        if (!entry) {
          throw new Error(`No Braintunnel user @${normalized} (confirmed handle).`)
        }
        const g = getActiveBrainQueryGrant({ ownerId: entry.userId, askerId: tenantId })
        if (!g) {
          throw new Error(
            `@${entry.handle} has not granted this workspace a tunnel (or it was revoked).`,
          )
        }
        return g
      }

      const grant = await resolveGrant()
      if (!grant) {
        throw new Error('Grant not found.')
      }
      if (grant.revoked_at_ms != null) {
        throw new Error('This grant was revoked.')
      }
      if (grant.asker_id !== tenantId) {
        throw new Error('This grant is not yours to send from (wrong workspace).')
      }
      const peerPrimaryEmail = await getPrimaryEmailForUserId(grant.asker_id)
      if (!peerPrimaryEmail?.trim()) {
        throw new Error(
          'Your workspace has no primary mailbox on file; connect mail so your collaborator can reply by email.',
        )
      }
      const question = params.question.trim()
      const subject = summarySubjectFromQuestion(question)
      const askerHome = tenantHomeDir(tenantId)
      const askerMeta = await readHandleMeta(askerHome)
      const payload: Record<string, unknown> = {
        grantId: grant.id,
        peerUserId: tenantId,
        peerPrimaryEmail: peerPrimaryEmail.trim(),
        question,
        subject,
      }
      if (
        askerMeta &&
        typeof askerMeta.confirmedAt === 'string' &&
        askerMeta.confirmedAt.length > 0 &&
        typeof askerMeta.handle === 'string' &&
        askerMeta.handle.trim()
      ) {
        payload.peerHandle = askerMeta.handle.trim()
      }
      await createNotificationForTenant(grant.owner_id, {
        sourceKind: 'brain_query_question',
        payload,
      })
      const lines = [
        'Your question was delivered to their Braintunnel notifications.',
        `Preview: ${subject}`,
        'Acknowledge briefly; you will get an in-app ping when they send—open it to refresh Sources and read inbound mail.',
      ]
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { ok: true, subject },
      }
    },
  })
}
