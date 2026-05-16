import { SLACK_HELLO_WORLD_TEXT } from '@server/lib/slack/slackHelloWorld.js'
import { getSlackBotUserId } from '@server/lib/slack/slackBotUserId.js'
import type { MessagingQuery } from './types.js'
import { listLinkedUsersInWorkspace, resolveLinkedTenant } from './linkedUsers.js'
import { parseAllSlackUserMentions } from './parseSlackMention.js'

const WHO_HAS_PHRASES = [
  'who has braintunnel',
  'who has brain tunnel',
  'who is on braintunnel',
  'who uses braintunnel',
  'who else has',
  'who has access',
  'who is linked',
  'who uses brain',
]

export function isWhoHasBraintunnelQuery(text: string): boolean {
  const norm = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!norm.includes('braintunnel') && !norm.includes('brain tunnel')) return false
  if (WHO_HAS_PHRASES.some((p) => norm.includes(p))) return true
  // e.g. "who else has access to braintunnel?"
  return /\bwho\b/.test(norm) && (/\bwho\b.*\b(braintunnel|brain tunnel)\b/.test(norm) || /\b(access|linked|enrolled)\b/.test(norm))
}

export type HelloDispatchResult =
  | {
      kind: 'text'
      text: string
      /** When set, caller resolves display names (e.g. via Slack users.info). */
      linkedUserIds?: string[]
    }
  | {
      kind: 'agentRun'
      /** Slack user id of the owner whose corpus should be queried. */
      ownerSlackUserId: string
      /** Tenant user id of the owner (resolved from slack_user_links). */
      ownerTenantUserId: string
    }

/**
 * Pick whose Braintunnel corpus should answer from @mentions in the message.
 * Always ignores the workspace bot id (required @mention to invoke in channels).
 * Multiple linked humans: first in message order (disambiguation UX deferred).
 */
export function resolveOwnerFromSlackMentions(params: {
  text: string
  slackTeamId: string
  requesterSlackUserId: string
  botSlackUserId?: string | null
}): HelloDispatchResult | null {
  const exclude = new Set(
    [params.requesterSlackUserId, params.botSlackUserId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  )
  const humanMentions = parseAllSlackUserMentions(params.text).filter((id) => !exclude.has(id))

  const linkedTargets: { slackUserId: string; tenantUserId: string }[] = []
  const unlinkedTargets: string[] = []
  for (const mentionId of humanMentions) {
    const linked = resolveLinkedTenant(params.slackTeamId, mentionId)
    if (linked) {
      linkedTargets.push({ slackUserId: mentionId, tenantUserId: linked.tenant_user_id })
    } else {
      unlinkedTargets.push(mentionId)
    }
  }

  if (linkedTargets.length >= 1) {
    const first = linkedTargets[0]!
    return {
      kind: 'agentRun',
      ownerSlackUserId: first.slackUserId,
      ownerTenantUserId: first.tenantUserId,
    }
  }
  if (unlinkedTargets.length === 1) {
    const mentionId = unlinkedTargets[0]!
    return {
      kind: 'text',
      text: `<@${mentionId}> has not linked Braintunnel yet. They can link in Braintunnel Settings → Connections.`,
    }
  }
  return null
}

export async function dispatchHelloResponse(
  query: MessagingQuery,
  opts?: {
    formatLinkedNames?: (links: { slackUserId: string }[]) => Promise<string>
    /** Inject for tests; otherwise resolved via auth.test. */
    botSlackUserId?: string | null
  },
): Promise<HelloDispatchResult> {
  if (isWhoHasBraintunnelQuery(query.text)) {
    const links = listLinkedUsersInWorkspace(query.slackTeamId)
    if (links.length === 0) {
      return {
        kind: 'text',
        text: 'No one has linked Braintunnel in this workspace yet. Connect in Braintunnel Settings → Connections.',
      }
    }
    if (opts?.formatLinkedNames) {
      const formatted = await opts.formatLinkedNames(
        links.map((l) => ({ slackUserId: l.slack_user_id })),
      )
      return { kind: 'text', text: `People linked to Braintunnel here: ${formatted}` }
    }
    const ids = links.map((l) => `<@${l.slack_user_id}>`).join(', ')
    return {
      kind: 'text',
      text: `People linked to Braintunnel here: ${ids}`,
      linkedUserIds: links.map((l) => l.slack_user_id),
    }
  }

  const botSlackUserId =
    opts?.botSlackUserId !== undefined
      ? opts.botSlackUserId
      : await getSlackBotUserId(query.slackTeamId)
  const mentionRoute = resolveOwnerFromSlackMentions({
    text: query.text,
    slackTeamId: query.slackTeamId,
    requesterSlackUserId: query.requesterSlackUserId,
    botSlackUserId,
  })
  if (mentionRoute) return mentionRoute

  // No other human @mention: route to requester's corpus if linked
  const selfLinked = resolveLinkedTenant(query.slackTeamId, query.requesterSlackUserId)
  if (selfLinked) {
    return {
      kind: 'agentRun',
      ownerSlackUserId: query.requesterSlackUserId,
      ownerTenantUserId: selfLinked.tenant_user_id,
    }
  }

  return { kind: 'text', text: SLACK_HELLO_WORLD_TEXT }
}
