/**
 * Shared approve/decline logic for b2b_inbound sessions.
 *
 * Used by both the Brain REST endpoint (b2bChat.ts) and the Slack interactions
 * webhook (slackInteractions.ts). Handles two delivery paths:
 *   - slackDelivery present → post via Slack adapter, update Block Kit
 *   - B2B tunnel → appendAssistantToAsker (existing path)
 */
import { getBrainQueryGrantById } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { loadSession, updateApprovalState } from './chatStorage.js'
import type { MessagingAdapter } from '@server/lib/messaging/types.js'

const DECLINE_TEXT = "I can't answer that right now. The owner chose not to respond via Braintunnel."

export type InboundApprovalResult =
  | { ok: true }
  | { error: string; status: 400 | 404 | 409 | 500 }

/**
 * Approve a b2b_inbound session. Handles both Slack-delivery and B2B-tunnel cases.
 *
 * Caller must already be running inside `runWithTenantContextAsync(ownerCtx)`.
 *
 * @param appendAssistantToAsker - supply the b2bChat helper for B2B tunnel delivery;
 *   not called when slackDelivery is present.
 */
export async function approveInboundSession(
  sessionId: string,
  ownerTenantUserId: string,
  opts: {
    editedText?: string
    slackAdapter?: MessagingAdapter
    appendAssistantToAsker?: (grantRow: unknown, draft: string, traceSessionId: string) => Promise<void>
  } = {},
): Promise<InboundApprovalResult> {
  const session = await loadSession(sessionId)
  if (!session || session.sessionType !== 'b2b_inbound') {
    return { error: 'not_found', status: 404 }
  }
  if (session.approvalState !== 'pending') {
    return { error: 'not_pending', status: 409 }
  }

  // Determine draft text (findLast not available in all tsconfig targets; reverse scan)
  let lastAssist = null
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i]
    if (m && m.role === 'assistant') { lastAssist = m; break }
  }
  const baseDraft = lastAssist?.content?.trim() ?? ''
  const draft = opts.editedText?.trim() || baseDraft
  if (!draft) return { error: 'draft_not_found', status: 400 }

  await updateApprovalState(sessionId, 'approved')

  // --- Slack delivery ---
  if (session.slackDelivery && opts.slackAdapter) {
    const sd = session.slackDelivery
    const attribution = `_Answered on behalf of ${sd.ownerDisplayName} · via Braintunnel_`
    try {
      await opts.slackAdapter.postFinalReply(
        {
          channelId: sd.requesterChannelId,
          threadTs: sd.requesterThreadTs,
          slackTeamId: sd.slackTeamId,
        },
        draft,
        attribution,
      )
    } catch {
      /* log externally; don't fail the approval */
    }
    if (sd.ownerApprovalMessageTs && sd.ownerApprovalChannelId) {
      try {
        await opts.slackAdapter.updateApprovalMessage(
          sd.ownerApprovalMessageTs,
          sd.ownerApprovalChannelId,
          sd.slackTeamId,
          'approved',
        )
      } catch {
        /* non-fatal */
      }
    }
    return { ok: true }
  }

  // --- B2B tunnel delivery ---
  if (!session.remoteGrantId) return { error: 'not_found', status: 404 }
  const grant = getBrainQueryGrantById(session.remoteGrantId)
  if (!grant || grant.owner_id !== ownerTenantUserId) return { error: 'not_found', status: 404 }
  if (opts.appendAssistantToAsker) {
    await opts.appendAssistantToAsker(grant, draft, sessionId)
  }
  return { ok: true }
}

/**
 * Decline a b2b_inbound session. Handles both Slack-delivery and B2B-tunnel cases.
 *
 * Caller must already be running inside `runWithTenantContextAsync(ownerCtx)`.
 */
export async function declineInboundSession(
  sessionId: string,
  ownerTenantUserId: string,
  opts: {
    slackAdapter?: MessagingAdapter
    appendAssistantToAsker?: (grantRow: unknown, draft: string, traceSessionId: string) => Promise<void>
  } = {},
): Promise<InboundApprovalResult> {
  const session = await loadSession(sessionId)
  if (!session || session.sessionType !== 'b2b_inbound') {
    return { error: 'not_found', status: 404 }
  }
  if (session.approvalState !== 'pending') {
    return { error: 'not_pending', status: 409 }
  }

  await updateApprovalState(sessionId, 'declined')

  // --- Slack delivery ---
  if (session.slackDelivery && opts.slackAdapter) {
    const sd = session.slackDelivery
    try {
      await opts.slackAdapter.postFinalReply(
        {
          channelId: sd.requesterChannelId,
          threadTs: sd.requesterThreadTs,
          slackTeamId: sd.slackTeamId,
        },
        DECLINE_TEXT,
        '',
      )
    } catch {
      /* non-fatal */
    }
    if (sd.ownerApprovalMessageTs && sd.ownerApprovalChannelId) {
      try {
        await opts.slackAdapter.updateApprovalMessage(
          sd.ownerApprovalMessageTs,
          sd.ownerApprovalChannelId,
          sd.slackTeamId,
          'declined',
        )
      } catch {
        /* non-fatal */
      }
    }
    return { ok: true }
  }

  // --- B2B tunnel delivery ---
  if (!session.remoteGrantId) return { error: 'not_found', status: 404 }
  const grant = getBrainQueryGrantById(session.remoteGrantId)
  if (!grant || grant.owner_id !== ownerTenantUserId) return { error: 'not_found', status: 404 }
  if (opts.appendAssistantToAsker) {
    await opts.appendAssistantToAsker(grant, DECLINE_TEXT, sessionId)
  }
  return { ok: true }
}
