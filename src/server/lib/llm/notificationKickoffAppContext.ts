import type { NotificationKickoffHints } from '@shared/notifications/presentation.js'
import { getBrainQueryGrantById } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'

const APP_QUEUE_HEADER = '[App — notification queue item]' as const

/** Shared tail: app clears the notification when chat completes (agent must not mark it read). */
function completionSuffix(): string[] {
  return [
    '',
    '**Completion:** Do **not** call **mark_notification** to clear this notification as part of your default wrap-up; the app marks it handled when the user finishes this chat.',
  ]
}

function routingBullets(h: NotificationKickoffHints): string[] {
  return [`- notification_id: ${h.notificationId}`, `- source_kind: ${h.sourceKind}`]
}

function brainQueryGrantReceivedAppContext(h: NotificationKickoffHints): string {
  const meta = [...routingBullets(h)]
  if (h.peerHandle) meta.push(`- peer_handle: @${h.peerHandle}`)
  if (h.grantId) meta.push(`- grant_id (opaque): \`${h.grantId}\``)

  const peer = h.peerHandle?.trim() ?? ''

  return [
    APP_QUEUE_HEADER,
    '',
    'The user opened an unread notification: another workspace **connected them** so they can ask that person questions from chat (answers come back asynchronously; the user gets notified when there is something new).',
    '',
    ...meta,
    '',
    `**Interaction:** Welcome the connection in plain language (no transport or implementation detail unless they ask). When they want to **send a question** to ${peer ? `**@${peer}**` : 'the sharer'}, use **ask_collaborator** with \`grant_id\` and their question — it composes and **sends immediately** (no separate draft approval step). After a successful send, confirm briefly and set the expectation that they will get a notification when the other person responds.`,
    '',
    '**If** they say they never get alerts for messages from this connection, you may help them add or verify an **inbox_rules** rule (subject matches `[braintunnel]`, action **notify**). Do not lead with that.',
    '',
    'Do **not** default to telling them to open **Settings**—only mention review/revoke there if they ask about managing access.',
    ...completionSuffix(),
    '',
    'Use normal assistant tools only if the user asks for vault or mail follow-up.',
  ].join('\n')
}

function brainQueryMailAppContext(h: NotificationKickoffHints): string {
  const meta = [...routingBullets(h)]
  if (h.messageId) meta.push(`- message_id: \`${h.messageId}\``)
  if (h.subject) meta.push(`- subject: ${JSON.stringify(h.subject)}`)
  if (h.grantId) meta.push(`- grant_id (opaque): \`${h.grantId}\``)
  if (h.peerHandle) meta.push(`- peer_handle: @${h.peerHandle}`)
  if (h.peerUserId) meta.push(`- peer_user_id (opaque): \`${h.peerUserId}\``)
  if (h.peerPrimaryEmail) meta.push(`- peer_primary_email: ${JSON.stringify(h.peerPrimaryEmail)}`)

  const grant = h.grantId?.trim() ? getBrainQueryGrantById(h.grantId.trim()) : null
  const policyBlock =
    grant && grant.privacy_policy.trim().length > 0
      ? [
          '',
          '**Grant policy (instructions for drafting a reply; not a cryptographic guarantee):**',
          grant.privacy_policy.trim(),
        ].join('\n')
      : ''

  return [
    APP_QUEUE_HEADER,
    '',
    'The user opened a notification: someone they have a **shared-brain** connection with sent them a question (routed through mail under the hood — do not explain that unless they ask).',
    '',
    ...meta,
    policyBlock,
    '',
    '**Interaction:** Use **read_mail_message** with the message id above. Summarize what they are being asked in plain language. To **draft a reply**, use **draft_email** with **action=reply**, **b2b_query: true**, and **grant_id** when you have it so the thread stays on the collaborator path. Respect the grant policy. Use **send_draft** only after the user has seen the draft and wants it sent (human-in-the-loop).',
    ...completionSuffix(),
    '',
    'Use normal assistant tools as needed.',
  ].join('\n')
}

/** mail_notify and any unknown `source_kind`: inbox-style routing + tools. */
function mailNotifyOrDefaultAppContext(h: NotificationKickoffHints): string {
  const lines: string[] = [
    APP_QUEUE_HEADER,
    '',
    'The user opened one unread app notification (routing metadata below; avoid dumping raw ids into prose unless the user asks).',
    '',
    ...routingBullets(h),
  ]

  if (h.actionRequired) {
    lines.push('', 'This message is flagged **action required** in inbox triage—prioritize concrete next steps or replies.')
  }

  const mid = h.messageId?.trim()
  if (mid) {
    lines.push('', `Use **read_mail_message** with this exact message id (verbatim): \`${mid}\``)
  } else if (h.subject?.trim()) {
    lines.push(
      '',
      `No message id on file; locate the message with **search_index** or **list_inbox**. Subject hint: ${JSON.stringify(h.subject.trim())}`,
    )
  } else {
    lines.push('', 'No message id on file; use **search_index** or **list_inbox** to locate the relevant message.')
  }

  lines.push(
    '',
    '**Interaction:** Lead briefly—what needs attention in plain language. Offer a few concrete options. Stay concise.',
    ...completionSuffix(),
    '',
    'Use normal assistant tools as needed.',
  )

  return lines.join('\n')
}

type AppContextBuilder = (h: NotificationKickoffHints) => string

/**
 * Register handlers per `NotificationKickoffHints.sourceKind`.
 * Unknown kinds fall through to {@link mailNotifyOrDefaultAppContext} (mail_notify shape).
 */
const NOTIFICATION_APP_CONTEXT_BY_KIND: Record<string, AppContextBuilder> = {
  brain_query_grant_received: brainQueryGrantReceivedAppContext,
  brain_query_mail: brainQueryMailAppContext,
}

export function notificationKickoffAppContextText(h: NotificationKickoffHints): string {
  const build = NOTIFICATION_APP_CONTEXT_BY_KIND[h.sourceKind]
  return build ? build(h) : mailNotifyOrDefaultAppContext(h)
}
