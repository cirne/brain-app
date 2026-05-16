/**
 * Orchestration for Slack-sourced inbound delegation turns (OPP-118).
 *
 * Flow: resolve owner tenant → run integrationAgent under owner context →
 * privacy filter → persist b2b_inbound session with slackDelivery →
 * send Block Kit approval request to owner DM → attach message ts.
 */
import { randomUUID } from 'node:crypto'
import { webApi } from '@slack/bolt'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { createIntegrationAgent } from '@server/agent/integrationAgent.js'
import { promptAgentForText } from '@server/agent/corpusReply/index.js'
import { filterCorpusReply, SLACK_DEFAULT_CORPUS_POLICY } from '@server/agent/corpusReply/index.js'
import {
  appendTurn,
  attachSlackApprovalMessageTs,
  ensureSessionStub,
  updateApprovalState,
} from '@server/lib/chat/chatStorage.js'
import { createNotificationForTenant } from '@server/lib/notifications/createNotificationForTenant.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { getWorkspaceBotToken, resolveLinkedTenant } from '@server/lib/slack/slackConnectionsRepo.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readLinkedMailboxesFor } from '@server/lib/tenant/linkedMailboxes.js'
import type { MessagingQuery, SlackDelivery } from './types.js'
import type { MessagingAdapter } from './types.js'
import type { SlackSessionDelivery } from '@server/lib/chat/chatTypes.js'

/**
 * Resolve owner display name: prefer Slack `users.info` (real name from the workspace),
 * then fall back to `handle-meta.json`, then raw tenant ID. Slack always has the most
 * accurate current name and doesn't require the user to have set up a Braintunnel profile.
 */
async function resolveOwnerDisplayName(params: {
  ownerSlackUserId: string
  slackTeamId: string
  ownerTenantUserId: string
}): Promise<{ displayName: string; handle: string }> {
  const token = getWorkspaceBotToken(params.slackTeamId)
  if (token) {
    try {
      const client = new webApi.WebClient(token)
      const r = await client.users.info({ user: params.ownerSlackUserId })
      const slackName =
        r.user?.profile?.display_name?.trim() ||
        r.user?.profile?.real_name?.trim() ||
        r.user?.name?.trim() ||
        ''
      if (slackName) {
        const homeDir = ensureTenantHomeDir(params.ownerTenantUserId)
        const meta = await readHandleMeta(homeDir)
        const handle = meta?.handle ?? params.ownerTenantUserId
        return { displayName: slackName, handle }
      }
    } catch {
      /* fall through */
    }
  }
  const homeDir = ensureTenantHomeDir(params.ownerTenantUserId)
  const meta = await readHandleMeta(homeDir)
  const handle = meta?.handle ?? params.ownerTenantUserId
  const displayName = (typeof meta?.displayName === 'string' && meta.displayName.trim())
    ? meta.displayName.trim()
    : handle
  return { displayName, handle }
}

/** Resolve requester's display name from Slack, falling back to @mention. */
async function resolveRequesterDisplayName(
  slackTeamId: string,
  requesterSlackUserId: string,
): Promise<string> {
  const token = getWorkspaceBotToken(slackTeamId)
  if (token) {
    try {
      const client = new webApi.WebClient(token)
      const r = await client.users.info({ user: requesterSlackUserId })
      const name =
        r.user?.profile?.display_name?.trim() ||
        r.user?.profile?.real_name?.trim() ||
        r.user?.name?.trim() ||
        ''
      if (name) return name
    } catch {
      /* fall through */
    }
  }
  return `<@${requesterSlackUserId}>`
}

/**
 * Build a rich identity string for a Slack user that the agent can use as a search term.
 *
 * Resolution chain: Slack user ID → slack_user_links DB → all linked mailboxes for that tenant.
 * Format: "DisplayName (email1, email2)" so find_person and search_index both work.
 *
 * Without this, the agent receives raw Slack IDs like "<@U09JYEZARPY>" in the question and
 * calls find_person("U09JYEZARPY") which finds nothing.
 *
 * Exported for unit tests.
 */
export async function resolveSlackUserIdentity(params: {
  slackTeamId: string
  slackUserId: string
  displayName: string
}): Promise<string> {
  const emails: string[] = []
  const link = resolveLinkedTenant(params.slackTeamId, params.slackUserId)
  if (link) {
    if (link.slack_email) emails.push(link.slack_email)
    try {
      const home = tenantHomeDir(link.tenant_user_id)
      const mailboxes = await readLinkedMailboxesFor(home)
      for (const m of mailboxes.mailboxes) {
        if (m.email && !emails.includes(m.email)) emails.push(m.email)
      }
    } catch {
      /* best-effort */
    }
  }
  return emails.length > 0 ? `${params.displayName} (${emails.join(', ')})` : params.displayName
}

/**
 * Replace <@SLACK_USER_ID> mentions in the question with rich identity strings
 * (display name + linked email addresses) so the agent can search by name and email.
 */
async function resolveSlackMentions(
  text: string,
  slackTeamId: string,
  knownMap: Map<string, string>,
): Promise<string> {
  const mentionedIds = [...text.matchAll(/<@(U[A-Z0-9]+)>/gi)].map(m => m[1]!)
  await Promise.all(mentionedIds.map(async (uid) => {
    if (knownMap.has(uid)) return
    const link = resolveLinkedTenant(slackTeamId, uid)
    if (!link) { knownMap.set(uid, uid); return }
    const token = getWorkspaceBotToken(slackTeamId)
    let name = uid
    if (token) {
      try {
        const r = await new webApi.WebClient(token).users.info({ user: uid })
        name = r.user?.profile?.display_name?.trim() || r.user?.profile?.real_name?.trim() || r.user?.name?.trim() || uid
      } catch { /* ignore */ }
    }
    const identity = await resolveSlackUserIdentity({ slackTeamId, slackUserId: uid, displayName: name })
    knownMap.set(uid, identity)
  }))
  return text.replace(/<@(U[A-Z0-9]+)>/gi, (_, uid: string) => knownMap.get(uid) ?? uid)
}

export async function runSlackIntegrationTurn(params: {
  query: MessagingQuery
  ownerSlackUserId: string
  ownerTenantUserId: string
  adapter: MessagingAdapter
}): Promise<void> {
  const { query, ownerSlackUserId, ownerTenantUserId, adapter } = params

  const ownerHomeDir = ensureTenantHomeDir(ownerTenantUserId)
  const ownerVis = await resolveOwnerDisplayName({
    ownerSlackUserId,
    slackTeamId: query.slackTeamId,
    ownerTenantUserId,
  })
  const requesterHint = await resolveRequesterDisplayName(
    query.slackTeamId,
    query.requesterSlackUserId,
  )

  await adapter.sendResponse(
    query,
    `Looking into this with ${ownerVis.displayName}'s assistant — you'll hear back shortly.`,
  )

  const ownerCtx = {
    tenantUserId: ownerTenantUserId,
    workspaceHandle: ownerVis.handle,
    homeDir: ownerHomeDir,
  }

  await runWithTenantContextAsync(ownerCtx, async () => {
    const sessionId = randomUUID()
    const ownerApprovalChannelId = ''

    const slackDelivery: SlackSessionDelivery = {
      slackTeamId: query.slackTeamId,
      requesterSlackUserId: query.requesterSlackUserId,
      requesterChannelId: query.channelId,
      requesterThreadTs: query.threadTs,
      requesterVenue: query.venue,
      ownerSlackUserId,
      ownerApprovalChannelId,
      requesterDisplayHint: requesterHint,
      ownerDisplayName: ownerVis.displayName,
    }

    await ensureSessionStub(sessionId, {
      sessionType: 'b2b_inbound',
      approvalState: 'pending',
      slackDelivery,
      remoteHandle: `slack:${query.requesterSlackUserId}`,
      remoteDisplayName: requesterHint,
    })

    let draftText: string
    try {
      // Resolve Slack @mentions to "DisplayName (email)" before passing to agent.
      // Without this the agent searches for raw Slack user IDs (e.g. "U09JYEZARPY").
      const ownerIdentity = await resolveSlackUserIdentity({
        slackTeamId: query.slackTeamId,
        slackUserId: ownerSlackUserId,
        displayName: ownerVis.displayName,
      })
      const requesterIdentity = query.requesterSlackUserId === ownerSlackUserId
        ? ownerIdentity
        : await resolveSlackUserIdentity({
            slackTeamId: query.slackTeamId,
            slackUserId: query.requesterSlackUserId,
            displayName: requesterHint,
          })
      const mentionMap = new Map<string, string>([
        [ownerSlackUserId, ownerIdentity],
        [query.requesterSlackUserId, requesterIdentity],
      ])
      const resolvedQuestion = await resolveSlackMentions(query.text, query.slackTeamId, mentionMap)

      const agent = createIntegrationAgent(wikiDir(), {
        channel: 'slack',
        ownerDisplayName: ownerVis.displayName,
        ownerHandle: ownerVis.handle,
        venue: query.venue === 'dm' ? 'dm' : 'channel',
        requesterDisplayHint: requesterHint,
        promptClock: { tenantUserId: ownerTenantUserId },
      })
      const rawDraft = await promptAgentForText(agent, resolvedQuestion)
      draftText = await filterCorpusReply({
        privacyPolicy: SLACK_DEFAULT_CORPUS_POLICY,
        draftAnswer: rawDraft,
      })
    } catch (err) {
      brainLogger.error({ err }, '[slack] integration agent draft failed')
      draftText = "I wasn't able to draft a reply right now. You can respond manually from your Braintunnel inbox."
    }

    await appendTurn({
      sessionId,
      userMessage: query.text,
      assistantMessage: {
        role: 'assistant',
        content: draftText,
        parts: [{ type: 'text', content: draftText }],
      },
    })
    await updateApprovalState(sessionId, 'pending')

    await createNotificationForTenant(ownerTenantUserId, {
      sourceKind: 'slack_inbound_query',
      idempotencyKey: `slack_inbound:${sessionId}`,
      payload: {
        sessionId,
        slackTeamId: query.slackTeamId,
        requesterSlackUserId: query.requesterSlackUserId,
        requesterDisplayHint: requesterHint,
        question: query.text,
        pendingReview: true,
      },
    })

    const slackDeliveryForAdapter: SlackDelivery = {
      slackTeamId: query.slackTeamId,
      requesterSlackUserId: query.requesterSlackUserId,
      requesterChannelId: query.channelId,
      requesterThreadTs: query.threadTs,
      requesterVenue: query.venue,
      ownerSlackUserId,
      ownerApprovalChannelId,
      requesterDisplayHint: requesterHint,
      ownerDisplayName: ownerVis.displayName,
    }

    try {
      const { approvalMessageTs, approvalChannelId } = await adapter.sendApprovalRequest({
        sessionId,
        ownerTenantUserId,
        draftText,
        originalQuestion: query.text,
        slackDelivery: slackDeliveryForAdapter,
      })
      attachSlackApprovalMessageTs(sessionId, approvalMessageTs, approvalChannelId)
    } catch (err) {
      brainLogger.error({ err }, '[slack] sendApprovalRequest failed')
    }
  })
}

export function scheduleSlackIntegrationTurn(params: {
  query: MessagingQuery
  ownerSlackUserId: string
  ownerTenantUserId: string
  adapter: MessagingAdapter
}): void {
  void runSlackIntegrationTurn(params).catch((err) => {
    brainLogger.error({ err }, '[slack] integration turn failed')
  })
}
