import { SLACK_HELLO_WORLD_TEXT } from '@server/lib/slack/slackHelloWorld.js'
import type { MessagingQuery } from './types.js'
import { listLinkedUsersInWorkspace, resolveLinkedTenant } from './linkedUsers.js'
import { parseFirstSlackUserMention } from './parseSlackMention.js'

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

export async function dispatchHelloResponse(
  query: MessagingQuery,
  opts?: {
    formatLinkedNames?: (links: { slackUserId: string }[]) => Promise<string>
  },
): Promise<HelloDispatchResult> {
  if (query.venue === 'public_channel') {
    return { kind: 'text', text: SLACK_HELLO_WORLD_TEXT }
  }

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

  // Explicit @mention of another user
  const mentionId = parseFirstSlackUserMention(query.text)
  if (mentionId && mentionId !== query.requesterSlackUserId) {
    const linked = resolveLinkedTenant(query.slackTeamId, mentionId)
    if (linked) {
      return {
        kind: 'agentRun',
        ownerSlackUserId: mentionId,
        ownerTenantUserId: linked.tenant_user_id,
      }
    }
    return {
      kind: 'text',
      text: `<@${mentionId}> has not linked Braintunnel yet. They can link in Braintunnel Settings → Connections.`,
    }
  }

  // Self-directed DM (no mention, or requester mentions themselves): route to their own corpus if linked
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
