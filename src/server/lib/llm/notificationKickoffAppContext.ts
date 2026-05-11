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
    `**Interaction:** Welcome the connection in plain language (no transport or implementation detail unless they ask). When they want to **send a question** to ${peer ? `**@${peer}**` : 'the sharer'}, use **ask_collaborator** with their question and **either** \`grant_id\` from above **or** \`peer_handle\` (\`${peer ? `@${peer}` : '@their-handle'}\`) — the server resolves the grant at send time, including on later turns without kickoff metadata. It **delivers immediately** as an in-app notification on their workspace (no separate draft approval step). After success, confirm briefly; they will get notified when the other person responds (by mail).`,
    '',
    '**If** they rely on email for those replies and say alerts never arrive, you may help them add or verify an **inbox_rules** rule (subject matches `[braintunnel]`, action **notify**). Do not lead with that.',
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
    '**Interaction:** Use **read_mail_message** with the message id above. Summarize what they are being asked in plain language. To **draft a reply**, use **draft_email** with **action=reply**, **body** as the final reply text, **subject** if you want to override the default Re: line, **b2b_query: true**, and **grant_id** when you have it (the server ensures the `[braintunnel]` subject prefix when it is missing). Respect the grant policy. Use **send_draft** only after the user has seen the draft and wants it sent (human-in-the-loop).',
    ...completionSuffix(),
    '',
    'Use normal assistant tools as needed.',
  ].join('\n')
}

function brainQueryQuestionAppContext(h: NotificationKickoffHints): string {
  const meta = [...routingBullets(h)]
  if (h.grantId) meta.push(`- grant_id (opaque): \`${h.grantId}\``)
  if (h.peerHandle) meta.push(`- peer_handle: @${h.peerHandle}`)
  if (h.peerUserId) meta.push(`- peer_user_id (opaque): \`${h.peerUserId}\``)
  if (h.peerPrimaryEmail) meta.push(`- peer_primary_email (reply **to**): ${JSON.stringify(h.peerPrimaryEmail)}`)
  const q = h.question?.trim() ?? ''
  const questionBlock =
    q.length > 0
      ? ['', '**Question (in-app; there is no mail message id to read):**', q].join('\n')
      : ''

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
    'The user opened a notification: someone they have a **shared-brain** connection with asked them a question via **in-app notification** (not an inbound email).',
    '',
    ...meta,
    questionBlock,
    policyBlock,
    '',
    '**Interaction:** The question text is above; summarize it in plain language if useful. To **draft a reply**, use **draft_email** with **action=new**, **to** set exactly to `peer_primary_email`, **subject** and **body** as the final mail the recipient will read (not meta-instructions — there is no separate compose step), **b2b_query: true**, and **grant_id** for routing (the server ensures the `[braintunnel]` subject prefix when it is missing). Use **send_draft** only after the user has seen the draft and wants it sent (human-in-the-loop).',
    ...completionSuffix(),
    '',
    'Use normal assistant tools as needed.',
  ].join('\n')
}

/** Grant asker ping right after collaborator send — inbound reply may lag until ripmail refreshes. */
function brainQueryReplySentAppContext(h: NotificationKickoffHints): string {
  const meta = [...routingBullets(h)]
  if (h.grantId) meta.push(`- grant_id (opaque): \`${h.grantId}\``)
  if (h.peerHandle) meta.push(`- peer_handle: @${h.peerHandle}`)
  const subRaw = h.subject?.trim()
  if (subRaw) meta.push(`- subject_hint: ${JSON.stringify(subRaw)}`)

  return [
    APP_QUEUE_HEADER,
    '',
    'The user opened an in-app notification: a **shared-brain collaborator has already sent** their reply email from their workspace. Their inbox/index may lag until ripmail catches new mail via IMAP.',
    '',
    ...meta,
    '',
    '**Interaction (recommended order):** Say briefly who replied (using **peer_handle** when shown). Run **refresh_sources** so inbound mail indexes (omit **source** to sync configured mail; use a larger **max_wait_ms** toward **45000** when they need the newest mail now — **max_wait_ms: 0** is background-only when they prefer not to wait on this turn). Then **list_inbox** or **search_index** (use **subject:** filters with phrases drawn from subject_hint — keep **[braintunnel]** in queries when threading requires it). Use **read_mail_message** once a **message id** appears. If nothing arrives after refresh, widen the query or retry one sync rather than asserting send failure.',
    '',
    'A **brain_query_mail** row may also appear once rules mirror the inbound message — use this notification strictly as early wake-up + refresh/read guidance.',
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
  brain_query_question: brainQueryQuestionAppContext,
  brain_query_reply_sent: brainQueryReplySentAppContext,
}

export function notificationKickoffAppContextText(h: NotificationKickoffHints): string {
  const build = NOTIFICATION_APP_CONTEXT_BY_KIND[h.sourceKind]
  return build ? build(h) : mailNotifyOrDefaultAppContext(h)
}
