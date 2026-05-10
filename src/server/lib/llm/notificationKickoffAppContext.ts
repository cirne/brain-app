import type { NotificationKickoffHints } from '@shared/notifications/presentation.js'

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
  const mentionTry =
    peer.length > 0
      ? `**mentioning \`@${peer}\` in chat** with a concrete question (same UX as asking someone's brain in-app). `
      : '**mentioning them with @ in chat** with a concrete question. '

  return [
    APP_QUEUE_HEADER,
    '',
    'The user opened an unread notification about **brain-query sharing** (another workspace let them ask that workspace\'s assistant from chat—the sharer controls what may be used).',
    '',
    ...meta,
    '',
    `**Interaction:** Help them understand they can ask the sharer's workspace assistant from **their own** chat. Focus on **how to ask**: ${mentionTry}Do **not** default to telling them to open **Settings**—only mention review/revoke there if they ask about managing access. This is **not** email—do **not** use **read_mail_message** unless the user explicitly switches to mail.`,
    '',
    "**Cross-workspace mechanism:** Those answers are produced by invoking **`ask_brain`** (peer handle + question)—not by local wiki/mail search alone. Dev **`var/agent-diagnostics/`** chat traces have shown **`@handle …` turns ending with empty assistant text** when the model **stopped without calling `ask_brain`**; when you give tips, spell out that cross-brain questions require **`ask_brain`** so users are not misled into thinking a bare @mention alone retrieves the sharer's context.",
    ...completionSuffix(),
    '',
    'Use normal assistant tools only if the user asks for vault or mail follow-up.',
  ].join('\n')
}

function brainQueryInboundAppContext(h: NotificationKickoffHints): string {
  const meta = [...routingBullets(h)]
  if (h.questionPreview) meta.push(`- question_preview: ${JSON.stringify(h.questionPreview)}`)
  if (h.logId) meta.push(`- brain_query_log_id (opaque): \`${h.logId}\``)
  if (h.peerUserId) meta.push(`- asker_workspace_id (opaque): \`${h.peerUserId}\``)
  if (h.deliveryMode) meta.push(`- delivery_mode: ${h.deliveryMode}`)

  return [
    APP_QUEUE_HEADER,
    '',
    'The user opened an unread notification about an **inbound brain-query** (someone queried this workspace via brain-query; research ran in owner context per policy).',
    '',
    ...meta,
    '',
    '**Interaction:** Summarize what happened (who asked, outcome status) and whether they should review **Settings → Sharing** or brain-query policy. Do **not** use **read_mail_message** for this event unless the user pivots to email.',
    ...completionSuffix(),
    '',
    'Use normal assistant tools only if relevant to follow-up the user requests.',
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
  brain_query_inbound: brainQueryInboundAppContext,
}

export function notificationKickoffAppContextText(h: NotificationKickoffHints): string {
  const build = NOTIFICATION_APP_CONTEXT_BY_KIND[h.sourceKind]
  return build ? build(h) : mailNotifyOrDefaultAppContext(h)
}
