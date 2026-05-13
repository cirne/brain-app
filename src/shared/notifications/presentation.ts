import { displaySubjectWithoutBraintunnelMarker } from '@shared/braintunnelMailMarker.js'

/** Max rows to render in empty-chat strip (not counting overflow hint). */
export const EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP = 3

/** Fetch one extra row to detect “more unread” without a COUNT query. */
export const EMPTY_CHAT_NOTIFICATION_FETCH_LIMIT = EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP + 1

const SUMMARY_MAX_CHARS = 72

export type NotificationPresentationInput = {
  id: string
  sourceKind: string
  payload: unknown
}

/** Sent on POST /api/chat as `notificationKickoff` — never shown as the user bubble. */
export type NotificationKickoffHints = {
  notificationId: string
  sourceKind: string
  messageId?: string
  subject?: string
  /** Brain-query grant notification — opaque ids for agent routing. */
  grantId?: string
  /** Other workspace handle (e.g. grant owner, or asker on `brain_query_mail`). */
  peerHandle?: string
  peerUserId?: string
  /** From mail payload `attention.actionRequired`. */
  actionRequired?: boolean
  /** Ask primary email when `peerHandle` is missing (`brain_query_mail`). */
  peerPrimaryEmail?: string
  /** Full question text for in-app `brain_query_question` notifications (no mail message). */
  question?: string
  /** Chat-native B2B inbound session to open. */
  b2bSessionId?: string
  /** Asker outbound session after owner releases a tunnel reply. */
  outboundSessionId?: string
  /** Owner inbound trace session (idempotency / correlation only). */
  inboundSessionId?: string
}

export type NotificationPresentation = {
  id: string
  sourceKind: string
  summaryLine: string
  /** Persisted user bubble text — short, no opaque IDs. */
  kickoffUserMessage: string
  /** Wire-only hints for the server agent prompt (see POST `notificationKickoff`). */
  kickoffHints: NotificationKickoffHints
}

function truncateOneLine(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  if (max <= 1) return '…'
  return `${t.slice(0, max - 1)}…`
}

function hintsFrom(input: NotificationPresentationInput): NotificationKickoffHints {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const base: NotificationKickoffHints = {
    notificationId: input.id,
    sourceKind: input.sourceKind,
  }
  const messageId = typeof p.messageId === 'string' ? p.messageId.trim() : ''
  const subject = typeof p.subject === 'string' ? p.subject.trim() : ''
  if (messageId) base.messageId = messageId
  if (subject) base.subject = subject

  const attention = p.attention && typeof p.attention === 'object' ? (p.attention as Record<string, unknown>) : {}
  if (attention.actionRequired === true) base.actionRequired = true

  const grantId = typeof p.grantId === 'string' ? p.grantId.trim() : ''
  const peerHandleDirect = typeof p.peerHandle === 'string' ? p.peerHandle.trim() : ''
  const ownerHandle = typeof p.ownerHandle === 'string' ? p.ownerHandle.trim() : ''
  const peerUserIdPayload = typeof p.peerUserId === 'string' ? p.peerUserId.trim() : ''
  if (grantId) base.grantId = grantId
  if (peerHandleDirect) base.peerHandle = peerHandleDirect.replace(/^@/, '')
  else if (ownerHandle) base.peerHandle = ownerHandle.replace(/^@/, '')
  if (peerUserIdPayload) base.peerUserId = peerUserIdPayload

  const peerPrimaryEmail = typeof p.peerPrimaryEmail === 'string' ? p.peerPrimaryEmail.trim() : ''
  if (peerPrimaryEmail) base.peerPrimaryEmail = peerPrimaryEmail

  const questionRaw = typeof p.question === 'string' ? p.question.trim() : ''
  if (questionRaw) base.question = questionRaw

  const b2bSessionId = typeof p.b2bSessionId === 'string' ? p.b2bSessionId.trim() : ''
  if (b2bSessionId) base.b2bSessionId = b2bSessionId

  const outboundSessionId = typeof p.outboundSessionId === 'string' ? p.outboundSessionId.trim() : ''
  const inboundSessionId = typeof p.inboundSessionId === 'string' ? p.inboundSessionId.trim() : ''
  if (outboundSessionId) base.outboundSessionId = outboundSessionId
  if (inboundSessionId) base.inboundSessionId = inboundSessionId

  return base
}

function mailNotifyPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const subject = typeof p.subject === 'string' ? p.subject.trim() : ''
  const attention = p.attention && typeof p.attention === 'object' ? (p.attention as Record<string, unknown>) : {}
  const actionRequired = attention.actionRequired === true
  const label = subject || 'Email'
  const summaryLine = truncateOneLine(`${actionRequired ? 'Action: ' : ''}${label}`, SUMMARY_MAX_CHARS)
  const kickoffUserMessage = actionRequired
    ? `This inbox item needs follow-up (action required). Subject: ${JSON.stringify(subject || 'email')}. Summarize what needs doing and suggest next steps.`
    : subject
      ? `Summarize this email from notifications: ${JSON.stringify(subject)}`
      : 'Summarize the email from this notification.'
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function brainQueryGrantReceivedPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const ownerHandle = typeof p.ownerHandle === 'string' ? p.ownerHandle.trim().replace(/^@/, '') : ''
  const summaryLine = truncateOneLine(
    ownerHandle ? `@${ownerHandle} is now sharing with you` : 'Someone is now sharing with you',
    SUMMARY_MAX_CHARS,
  )
  const kickoffUserMessage = ownerHandle
    ? `**@${ownerHandle}** is sharing with you — you can ask them questions from chat, they answer from their workspace under the policy they set, and you'll get notified when there's a reply.`
    : `Someone is sharing with you — you can ask them questions from chat, they answer from their workspace under the policy they set, and you'll get notified when there's a reply.`
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function brainQueryQuestionPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const handle = typeof p.peerHandle === 'string' ? p.peerHandle.trim().replace(/^@/, '') : ''
  const email = typeof p.peerPrimaryEmail === 'string' ? p.peerPrimaryEmail.trim() : ''
  const atLabel = handle ? `@${handle}` : email || 'Collaborator'
  const subject =
    typeof p.subject === 'string' && p.subject.trim()
      ? p.subject.trim()
      : typeof p.question === 'string' && p.question.trim()
        ? truncateOneLine(p.question.trim(), SUMMARY_MAX_CHARS)
        : '(question)'
  const summaryLine = truncateOneLine(`${atLabel} asked: ${subject}`, SUMMARY_MAX_CHARS)
  const kickoffUserMessage =
    atLabel === 'Collaborator'
      ? `Someone asked you a question — help them with an answer. Question: ${JSON.stringify(typeof p.question === 'string' ? p.question.trim() : '')}`
      : `**${atLabel}** asked you a question — help them with an answer. Question: ${JSON.stringify(typeof p.question === 'string' ? p.question.trim() : '')}`
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function b2bInboundQueryPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const handle = typeof p.peerHandle === 'string' ? p.peerHandle.trim().replace(/^@/, '') : ''
  const displayName = typeof p.peerDisplayName === 'string' ? p.peerDisplayName.trim() : ''
  const label = handle ? `@${handle}` : displayName || 'Someone'
  const question = typeof p.question === 'string' ? p.question.trim() : ''
  const pendingReview = p.pendingReview === true
  const baseSummary = pendingReview
    ? question
      ? `${label} — draft ready · ${question}`
      : `${label} — draft ready`
    : question
      ? `${label} asked your brain: ${question}`
      : `${label} asked your brain`
  const summaryLine = truncateOneLine(baseSummary, SUMMARY_MAX_CHARS)
  const kickoffUserMessage = pendingReview
    ? label === 'Someone'
      ? 'Someone messaged you through a tunnel — open Pending to send your reply.'
      : `**${label}** messaged you through a tunnel — open Pending to send your reply.`
    : label === 'Someone'
      ? 'Someone asked your brain a question. Open the inbound chat to review the draft answer.'
      : `**${label}** asked your brain a question. Open the inbound chat to review the draft answer.`
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function b2bTunnelOutboundUpdatedPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const summaryLine = truncateOneLine('Reply ready in your tunnel', SUMMARY_MAX_CHARS)
  const kickoffUserMessage =
    'Your collaborator sent a reply through the tunnel — open that tunnel chat to read the full message.'
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function brainQueryMailPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const handle = typeof p.peerHandle === 'string' ? p.peerHandle.trim().replace(/^@/, '') : ''
  const email = typeof p.peerPrimaryEmail === 'string' ? p.peerPrimaryEmail.trim() : ''
  const atLabel = handle ? `@${handle}` : email || 'Collaborator'
  const rawSubject = typeof p.subject === 'string' ? p.subject.trim() : ''
  const displaySubject = displaySubjectWithoutBraintunnelMarker(rawSubject) || '(no subject)'
  const summaryLine = truncateOneLine(`${atLabel} asked: ${displaySubject}`, SUMMARY_MAX_CHARS)
  const kickoffUserMessage =
    atLabel === 'Collaborator'
      ? 'Someone sent you a question — read it and help them with an answer.'
      : `**${atLabel}** sent you a question — read it and help them with an answer.`
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function brainQueryReplySentPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const handle = typeof p.peerHandle === 'string' ? p.peerHandle.trim().replace(/^@/, '') : ''
  const rawSubject = typeof p.subject === 'string' ? p.subject.trim() : ''
  const displaySubject = displaySubjectWithoutBraintunnelMarker(rawSubject) || '(no subject)'
  const atLabel = handle ? `@${handle}` : 'Your collaborator'
  const summaryLine = truncateOneLine(`${atLabel} replied — ${displaySubject}`, SUMMARY_MAX_CHARS)
  const kickoffUserMessage =
    atLabel === 'Your collaborator'
      ? `**Your collaborator just sent their reply.** Subject: ${JSON.stringify(displaySubject)}. Help me refresh my inbox so I can read it.`
      : `**${atLabel}** just sent their reply. Subject: ${JSON.stringify(displaySubject)}. Help me refresh my inbox so I can read it.`
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function fallbackPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const kind = input.sourceKind.trim() || 'unknown'
  const summaryLine = truncateOneLine(`Notification (${kind})`, SUMMARY_MAX_CHARS)
  const kickoffUserMessage = `Help me with this notification (${kind}).`
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

/**
 * Map a stored notification row to UI + kickoff text. Unknown kinds still get a safe generic kickoff.
 */
export function presentationForNotificationRow(input: NotificationPresentationInput): NotificationPresentation {
  if (input.sourceKind === 'mail_notify') {
    return mailNotifyPresentation(input)
  }
  if (input.sourceKind === 'brain_query_grant_received') {
    return brainQueryGrantReceivedPresentation(input)
  }
  if (input.sourceKind === 'brain_query_question') {
    return brainQueryQuestionPresentation(input)
  }
  if (input.sourceKind === 'b2b_inbound_query') {
    return b2bInboundQueryPresentation(input)
  }
  if (input.sourceKind === 'b2b_tunnel_outbound_updated') {
    return b2bTunnelOutboundUpdatedPresentation(input)
  }
  if (input.sourceKind === 'brain_query_mail') {
    return brainQueryMailPresentation(input)
  }
  if (input.sourceKind === 'brain_query_reply_sent') {
    return brainQueryReplySentPresentation(input)
  }
  return fallbackPresentation(input)
}
