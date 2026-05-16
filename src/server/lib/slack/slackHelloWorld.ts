import { type types, webApi } from '@slack/bolt'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export const SLACK_HELLO_WORLD_TEXT = 'Hello from Braintunnel! (hello-world)'

export function isSlackEventsConfigured(): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim()
  return Boolean(secret && secret.length > 0)
}

function webClient(): webApi.WebClient | null {
  const token = process.env.SLACK_BOT_TOKEN?.trim()
  if (!token) return null
  return new webApi.WebClient(token)
}

/** Handle Events API callbacks after URL verification (hello-world spike). */
export async function dispatchSlackHelloWorldEvent(event: unknown): Promise<void> {
  const client = webClient()
  if (!client) return
  if (!event || typeof event !== 'object') return

  const ev = event as { type?: string; subtype?: string; bot_id?: string; channel?: string }

  if (ev.type === 'app_mention') {
    const mention = event as types.AppMentionEvent
    if (!mention.channel) return
    await client.chat.postMessage({
      channel: mention.channel,
      text: SLACK_HELLO_WORLD_TEXT,
      thread_ts: mention.thread_ts ?? mention.ts,
    })
    return
  }

  if (ev.type === 'message') {
    const msg = event as types.GenericMessageEvent
    if (msg.channel_type !== 'im') return
    if (msg.subtype) return
    if (msg.bot_id) return
    if (!msg.channel) return
    await client.chat.postMessage({
      channel: msg.channel,
      text: SLACK_HELLO_WORLD_TEXT,
    })
  }
}

export function scheduleSlackHelloWorldEvent(event: unknown): void {
  void dispatchSlackHelloWorldEvent(event).catch((err) => {
    brainLogger.error({ err }, '[slack] hello-world dispatch failed')
  })
}
