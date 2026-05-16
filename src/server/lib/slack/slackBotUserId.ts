import { webApi } from '@slack/bolt'
import { getWorkspaceBotToken } from './slackConnectionsRepo.js'

const cache = new Map<string, string | null>()

/** Clear in-memory bot user id cache (tests). */
export function clearSlackBotUserIdCache(): void {
  cache.clear()
}

/** Slack user id for the installed bot (U…), via auth.test; cached per team. */
export async function getSlackBotUserId(slackTeamId: string): Promise<string | null> {
  if (cache.has(slackTeamId)) return cache.get(slackTeamId) ?? null
  const token = getWorkspaceBotToken(slackTeamId)
  if (!token) {
    cache.set(slackTeamId, null)
    return null
  }
  try {
    const client = new webApi.WebClient(token)
    const r = await client.auth.test()
    const id = typeof r.user_id === 'string' && r.user_id.trim() ? r.user_id.trim() : null
    cache.set(slackTeamId, id)
    return id
  } catch {
    cache.set(slackTeamId, null)
    return null
  }
}
