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
  logId?: string
  /** Other workspace handle (e.g. grant owner). */
  peerHandle?: string
  peerUserId?: string
  questionPreview?: string
  deliveryMode?: string
  /** From mail payload `attention.actionRequired`. */
  actionRequired?: boolean
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
  const logId = typeof p.logId === 'string' ? p.logId.trim() : ''
  const ownerHandle = typeof p.ownerHandle === 'string' ? p.ownerHandle.trim() : ''
  const askerId = typeof p.askerId === 'string' ? p.askerId.trim() : ''
  const questionPreview = typeof p.questionPreview === 'string' ? p.questionPreview.trim() : ''
  const deliveryMode = typeof p.deliveryMode === 'string' ? p.deliveryMode.trim() : ''
  if (grantId) base.grantId = grantId
  if (logId) base.logId = logId
  if (ownerHandle) base.peerHandle = ownerHandle
  if (askerId) base.peerUserId = askerId
  if (questionPreview) base.questionPreview = questionPreview
  if (deliveryMode) base.deliveryMode = deliveryMode

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
  const ownerHandle = typeof p.ownerHandle === 'string' ? p.ownerHandle.trim() : ''
  const summaryLine = truncateOneLine(
    ownerHandle ? `@${ownerHandle} is now sharing with you` : 'Someone is now sharing with you',
    SUMMARY_MAX_CHARS,
  )
  const kickoffUserMessage = ownerHandle
    ? `${ownerHandle} shared access so I can ask their workspace assistant from chat—they chose what's allowed. Explain **how to ask** them—mention @${ownerHandle} in chat with a concrete question.`
    : 'Someone shared access so I can ask their workspace assistant from chat—they chose what\'s allowed. Explain **how to ask** in chat (mention them with @ once their handle is known).'
  return {
    id: input.id,
    sourceKind: input.sourceKind,
    summaryLine,
    kickoffUserMessage,
    kickoffHints: hintsFrom(input),
  }
}

function brainQueryInboundPresentation(input: NotificationPresentationInput): NotificationPresentation {
  const p = input.payload && typeof input.payload === 'object' ? (input.payload as Record<string, unknown>) : {}
  const q = typeof p.questionPreview === 'string' ? p.questionPreview.trim() : ''
  const status = typeof p.status === 'string' ? p.status.trim() : ''
  const summaryLine = truncateOneLine(q ? `Inbound query: ${q}` : 'Inbound brain-query', SUMMARY_MAX_CHARS)
  const kickoffUserMessage =
    q || status
      ? `Someone ran a brain-query against my workspace (status ${status || 'unknown'}). Question: ${JSON.stringify(q || '(unknown)')}. Summarize what happened and whether I should adjust sharing.`
      : 'Someone used brain-query against my workspace. Help me understand what happened.'
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
  if (input.sourceKind === 'brain_query_inbound') {
    return brainQueryInboundPresentation(input)
  }
  return fallbackPresentation(input)
}
