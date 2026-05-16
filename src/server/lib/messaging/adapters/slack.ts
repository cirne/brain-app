import { type types, webApi } from '@slack/bolt'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { getWorkspaceBotToken } from '@server/lib/slack/slackConnectionsRepo.js'
import { dispatchHelloResponse } from '@server/lib/messaging/helloDispatcher.js'
import { scheduleSlackIntegrationTurn } from '@server/lib/messaging/runSlackIntegrationTurn.js'
import type {
  ApprovalDecision,
  ApprovalDraft,
  MessagingAdapter,
  MessagingQuery,
} from '@server/lib/messaging/types.js'

function webClient(token: string): webApi.WebClient {
  return new webApi.WebClient(token)
}

function tokenForTeam(slackTeamId: string): string | null {
  return getWorkspaceBotToken(slackTeamId)
}

/** Slack channel id prefix → venue (G = private channel, C = public, D = DM). */
export function slackVenueForChannelId(channelId: string): MessagingQuery['venue'] {
  if (channelId.startsWith('G')) return 'private_group'
  if (channelId.startsWith('D')) return 'dm'
  return 'public_channel'
}

function slackApprovalVenueLabel(venue?: MessagingQuery['venue']): string {
  if (venue === 'dm') return 'Slack DM'
  if (venue === 'private_group') return 'Slack private channel'
  if (venue === 'public_channel') return 'Slack channel'
  return 'Slack'
}

export function parseSlackEvent(event: unknown, teamId?: string): MessagingQuery | null {
  if (!event || typeof event !== 'object') return null
  const ev = event as { type?: string; team?: string }
  const slackTeamId =
    (typeof teamId === 'string' && teamId.trim()) ||
    (typeof ev.team === 'string' && ev.team.trim()) ||
    null
  if (!slackTeamId) return null

  if (ev.type === 'app_mention') {
    const mention = event as types.AppMentionEvent
    if (!mention.channel || !mention.user) return null
    return {
      slackTeamId,
      requesterSlackUserId: mention.user,
      venue: slackVenueForChannelId(mention.channel),
      text: mention.text ?? '',
      rawEventRef: event,
      channelId: mention.channel,
      threadTs: mention.thread_ts ?? mention.ts,
    }
  }

  if (ev.type === 'message') {
    const msg = event as types.GenericMessageEvent
    if (msg.channel_type !== 'im') return null
    if (msg.subtype) return null
    if (msg.bot_id) return null
    if (!msg.channel || !msg.user) return null
    const mentionTarget = (msg.text ?? '').match(/<@(U[A-Z0-9]+)>/i)?.[1]
    return {
      slackTeamId,
      requesterSlackUserId: msg.user,
      targetSlackUserId: mentionTarget && mentionTarget !== msg.user ? mentionTarget : undefined,
      venue: 'dm',
      text: msg.text ?? '',
      rawEventRef: event,
      channelId: msg.channel,
      threadTs: msg.ts, // thread replies under the original DM message
    }
  }

  return null
}

async function resolveDisplayNames(
  client: webApi.WebClient,
  slackUserIds: string[],
): Promise<string> {
  const labels: string[] = []
  for (const id of slackUserIds) {
    try {
      const r = await client.users.info({ user: id })
      const name =
        r.user?.profile?.display_name ||
        r.user?.profile?.real_name ||
        r.user?.name ||
        id
      labels.push(name)
    } catch {
      labels.push(id)
    }
  }
  return labels.join(', ')
}

export async function sendSlackMessagingResponse(
  query: MessagingQuery,
  text: string,
): Promise<void> {
  const token = tokenForTeam(query.slackTeamId)
  if (!token) return
  const client = webClient(token)
  await client.chat.postMessage({
    channel: query.channelId,
    text,
    thread_ts: query.threadTs,
  })
}

/** Build Block Kit blocks for owner approval request. */
export function buildApprovalBlocks(draft: ApprovalDraft): webApi.KnownBlock[] {
  const actionValue = JSON.stringify({
    ownerTenantUserId: draft.ownerTenantUserId,
    sessionId: draft.sessionId,
  })
  const requesterHint =
    draft.slackDelivery.requesterDisplayHint ||
    `<@${draft.slackDelivery.requesterSlackUserId}>`

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Review reply from your assistant', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*From:* ${requesterHint} (${slackApprovalVenueLabel(draft.slackDelivery.requesterVenue)})\n*Question:*\n>${draft.originalQuestion.replace(/\n/g, '\n>')}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Draft reply:*\n${draft.draftText}`,
      },
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Will be sent as: _Answered on behalf of ${draft.slackDelivery.ownerDisplayName} · via Braintunnel_`,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve', emoji: true },
          style: 'primary',
          action_id: 'slack_approve',
          value: actionValue,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Decline', emoji: true },
          style: 'danger',
          action_id: 'slack_decline',
          value: actionValue,
        },
      ],
    },
  ]
}

export async function sendApprovalRequest(
  draft: ApprovalDraft,
): Promise<{ approvalMessageTs: string; approvalChannelId: string }> {
  const { slackDelivery } = draft
  const token = tokenForTeam(slackDelivery.slackTeamId)
  if (!token) throw new Error(`No bot token for team ${slackDelivery.slackTeamId}`)
  const client = webClient(token)

  // Open a DM with the owner if we don't already have the channel id
  let channelId = slackDelivery.ownerApprovalChannelId
  if (!channelId) {
    const dm = await client.conversations.open({ users: slackDelivery.ownerSlackUserId })
    channelId = (dm.channel as { id?: string })?.id ?? ''
    if (!channelId) throw new Error('Could not open DM with owner')
  }

  const blocks = buildApprovalBlocks(draft)
  const res = await client.chat.postMessage({
    channel: channelId,
    text: `Review reply from your assistant (question from ${slackDelivery.requesterDisplayHint || slackDelivery.requesterSlackUserId})`,
    blocks,
  })
  return {
    approvalMessageTs: (res.ts as string) ?? '',
    approvalChannelId: channelId,
  }
}

/** Parse a Slack interactions callback payload (JSON string from form-encoded body). */
export function parseSlackInteraction(rawPayload: unknown): ApprovalDecision | null {
  if (typeof rawPayload !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawPayload)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  if (p.type !== 'block_actions') return null
  const actions = Array.isArray(p.actions) ? (p.actions as unknown[]) : []
  const action = actions[0]
  if (!action || typeof action !== 'object') return null
  const a = action as Record<string, unknown>
  const actionId = typeof a.action_id === 'string' ? a.action_id : ''
  const rawValue = typeof a.value === 'string' ? a.value : ''
  let decoded: { ownerTenantUserId?: unknown; sessionId?: unknown } = {}
  try {
    decoded = JSON.parse(rawValue) as typeof decoded
  } catch {
    return null
  }
  const ownerTenantUserId = typeof decoded.ownerTenantUserId === 'string' ? decoded.ownerTenantUserId : ''
  const sessionId = typeof decoded.sessionId === 'string' ? decoded.sessionId : ''
  if (!ownerTenantUserId || !sessionId) return null

  if (actionId === 'slack_approve') {
    return { kind: 'approve', ownerTenantUserId, sessionId }
  }
  if (actionId === 'slack_decline') {
    return { kind: 'decline', ownerTenantUserId, sessionId }
  }
  return null
}

export async function postFinalReply(
  target: { channelId: string; threadTs?: string; slackTeamId: string },
  text: string,
  attribution: string,
): Promise<void> {
  const token = tokenForTeam(target.slackTeamId)
  if (!token) return
  const client = webClient(token)
  await client.chat.postMessage({
    channel: target.channelId,
    thread_ts: target.threadTs,
    text: `${text}\n\n${attribution}`,
    mrkdwn: true,
  })
}

export async function updateApprovalMessage(
  ts: string,
  channelId: string,
  slackTeamId: string,
  status: 'approved' | 'declined',
): Promise<void> {
  const token = tokenForTeam(slackTeamId)
  if (!token) return
  const client = webClient(token)
  const statusText = status === 'approved' ? '✓ Sent' : '✗ Declined'
  await client.chat.update({
    channel: channelId,
    ts,
    text: `Reply ${statusText}.`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `Reply _${statusText}_.` },
      },
    ],
  })
}

export async function handleSlackMessagingEvent(
  event: unknown,
  teamId?: string,
): Promise<void> {
  const query = parseSlackEvent(event, teamId)
  if (!query) return

  const token = tokenForTeam(query.slackTeamId)
  if (!token) return
  const client = webClient(token)

  const result = await dispatchHelloResponse(query, {
    formatLinkedNames: (links) => resolveDisplayNames(client, links.map((l) => l.slackUserId)),
  })

  if (result.kind === 'text') {
    await sendSlackMessagingResponse(query, result.text)
    return
  }

  if (result.kind === 'agentRun') {
    scheduleSlackIntegrationTurn({
      query,
      ownerSlackUserId: result.ownerSlackUserId,
      ownerTenantUserId: result.ownerTenantUserId,
      adapter: slackMessagingAdapter,
    })
  }
}

export function scheduleSlackMessagingEvent(event: unknown, teamId?: string): void {
  void handleSlackMessagingEvent(event, teamId).catch((err) => {
    brainLogger.error({ err }, '[slack] messaging dispatch failed')
  })
}

export const slackMessagingAdapter: MessagingAdapter = {
  parseEvent: parseSlackEvent,
  sendResponse: sendSlackMessagingResponse,
  sendApprovalRequest,
  parseInteraction: parseSlackInteraction,
  postFinalReply,
  updateApprovalMessage,
}
