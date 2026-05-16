import { type types, webApi } from '@slack/bolt'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { getWorkspaceBotToken } from '@server/lib/slack/slackConnectionsRepo.js'
import { dispatchHelloResponse } from '@server/lib/messaging/helloDispatcher.js'
import type { MessagingAdapter, MessagingQuery } from '@server/lib/messaging/types.js'

function webClient(token: string): webApi.WebClient {
  return new webApi.WebClient(token)
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
      venue: 'public_channel',
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
  const token = getWorkspaceBotToken(query.slackTeamId)
  if (!token) return
  const client = webClient(token)
  await client.chat.postMessage({
    channel: query.channelId,
    text,
    thread_ts: query.threadTs,
  })
}

export async function handleSlackMessagingEvent(
  event: unknown,
  teamId?: string,
): Promise<void> {
  const query = parseSlackEvent(event, teamId)
  if (!query) return

  const token = getWorkspaceBotToken(query.slackTeamId)
  if (!token) return
  const client = webClient(token)

  const result = await dispatchHelloResponse(query, {
    formatLinkedNames: (links) => resolveDisplayNames(client, links.map((l) => l.slackUserId)),
  })

  await sendSlackMessagingResponse(query, result.text)
}

export function scheduleSlackMessagingEvent(event: unknown, teamId?: string): void {
  void handleSlackMessagingEvent(event, teamId).catch((err) => {
    brainLogger.error({ err }, '[slack] messaging dispatch failed')
  })
}

export const slackMessagingAdapter: MessagingAdapter = {
  parseEvent: parseSlackEvent,
  sendResponse: sendSlackMessagingResponse,
}
