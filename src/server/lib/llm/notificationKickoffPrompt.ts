import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { NotificationKickoffHints } from '@shared/notifications/presentation.js'
import { presentationForNotificationRow } from '@shared/notifications/presentation.js'
import { getNotificationById } from '@server/lib/notifications/notificationsRepo.js'
import { notificationKickoffAppContextText } from './notificationKickoffAppContext.js'

export { notificationKickoffAppContextText }

/**
 * For `brain_query_question`, replace wire hints with the SSOT payload from tenant SQLite
 * so the agent always sees `question` / `grantId` / peer mail even if the client omitted them.
 */
export function enrichNotificationKickoffFromDb(h: NotificationKickoffHints): NotificationKickoffHints {
  if (h.sourceKind !== 'brain_query_question') return h
  const nid = h.notificationId?.trim()
  if (!nid) return h
  const row = getNotificationById(nid)
  if (!row || row.sourceKind !== 'brain_query_question') return h
  const pres = presentationForNotificationRow({
    id: row.id,
    sourceKind: row.sourceKind,
    payload: row.payload,
  })
  return {
    ...pres.kickoffHints,
    notificationId: h.notificationId,
    sourceKind: h.sourceKind,
  }
}

/** Parse `notificationKickoff` from POST /api/chat JSON. Invalid shapes return null (ignored). */
export function parseNotificationKickoffFromBody(body: Record<string, unknown>): NotificationKickoffHints | null {
  const raw = body.notificationKickoff
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const notificationId = typeof o.notificationId === 'string' ? o.notificationId.trim() : ''
  const sourceKind = typeof o.sourceKind === 'string' ? o.sourceKind.trim() : ''
  if (!notificationId || !sourceKind) return null
  const messageId = typeof o.messageId === 'string' ? o.messageId.trim() : ''
  const subject = typeof o.subject === 'string' ? o.subject.trim() : ''
  const grantId = typeof o.grantId === 'string' ? o.grantId.trim() : ''
  const peerHandle = typeof o.peerHandle === 'string' ? o.peerHandle.trim() : ''
  const peerUserId = typeof o.peerUserId === 'string' ? o.peerUserId.trim() : ''
  const actionRequired = o.actionRequired === true

  const hints: NotificationKickoffHints = { notificationId, sourceKind }
  if (messageId) hints.messageId = messageId
  if (subject) hints.subject = subject
  if (grantId) hints.grantId = grantId
  if (peerHandle) hints.peerHandle = peerHandle
  if (peerUserId) hints.peerUserId = peerUserId
  if (actionRequired) hints.actionRequired = true
  const peerPrimaryEmail = typeof o.peerPrimaryEmail === 'string' ? o.peerPrimaryEmail.trim() : ''
  if (peerPrimaryEmail) hints.peerPrimaryEmail = peerPrimaryEmail
  const question = typeof o.question === 'string' ? o.question.trim() : ''
  if (question) hints.question = question
  return hints
}

/**
 * Prepend notification routing + interaction instructions, then either hear-replies pair or a single user line.
 */
export function mergeNotificationKickoffPromptMessages(
  userText: string,
  h: NotificationKickoffHints,
  hearRepliesMessages?: AgentMessage[],
): AgentMessage[] {
  const ts = Date.now()
  const notifMsg: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: notificationKickoffAppContextText(h) }],
    timestamp: ts,
  }
  if (hearRepliesMessages?.length) {
    return [notifMsg, ...hearRepliesMessages.map((m, i) => ({ ...m, timestamp: ts + 1 + i }))]
  }
  return [
    notifMsg,
    {
      role: 'user',
      content: [{ type: 'text', text: userText }],
      timestamp: ts + 1,
    },
  ]
}
