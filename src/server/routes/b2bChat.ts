import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { getTenantContext, runWithTenantContextAsync, type TenantContext } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import {
  getBrainQueryGrantById,
  getActiveBrainQueryGrant,
  createBrainQueryGrant,
  grantRowAutoSendEnabled,
  grantRowIgnoresInbound,
  listBrainQueryGrantsForAsker,
  setBrainQueryGrantPolicy,
  type BrainQueryGrantPolicy,
  type BrainQueryGrantRow,
} from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { DEFAULT_BRAIN_QUERY_PRIVACY_POLICY } from '@server/lib/brainQuery/defaultPrivacyPolicy.js'
import {
  appendTurn,
  ensureSessionStub,
  findB2BSession,
  loadSession,
  listB2BInboundReviewRows,
  listPendingInboundSessionIdsForGrant,
  replaceLastAssistantMessageInSession,
  replaceLastAwaitingPeerReviewOutboundAssistant,
  updateApprovalState,
  finalizeColdSessionWithGrant,
} from '@server/lib/chat/chatStorage.js'
import {
  resolveConfirmedHandle,
  resolveConfirmedTenantEntry,
  resolveUserIdByPrimaryEmail,
} from '@server/lib/tenant/workspaceHandleDirectory.js'
import { assertColdQueryRateAllowed, recordColdQuerySent } from '@server/lib/global/coldQueryRateLimits.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { createB2BAgent, filterB2BResponse, promptB2BAgentForText } from '@server/agent/b2bAgent.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { streamStaticAssistantSse } from '@server/lib/chat/streamAgentSse.js'
import { createNotificationForTenant } from '@server/lib/notifications/createNotificationForTenant.js'
import { createNotification } from '@server/lib/notifications/notificationsRepo.js'
import { B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT } from '@shared/b2bTunnelDelivery.js'

const b2bChat = new Hono()

type TunnelApi = {
  grantId: string
  ownerId: string
  ownerHandle: string
  ownerDisplayName: string
  sessionId: string | null
}

async function tenantContextForUser(userId: string): Promise<TenantContext> {
  const homeDir = ensureTenantHomeDir(userId)
  const meta = await readHandleMeta(homeDir)
  return {
    tenantUserId: userId,
    workspaceHandle: meta?.handle ?? userId,
    homeDir,
  }
}

async function displayNameForUser(userId: string): Promise<{ handle: string; displayName: string }> {
  const home = tenantHomeDir(userId)
  const meta = await readHandleMeta(home)
  const handle = meta?.handle ?? userId
  const profileName = typeof meta?.displayName === 'string' ? meta.displayName.trim() : ''
  const displayName = profileName.length > 0 ? profileName : handle
  return { handle, displayName }
}

function grantIsActiveForAsker(row: BrainQueryGrantRow | null, askerId: string): row is BrainQueryGrantRow {
  return row != null && row.asker_id === askerId && row.revoked_at_ms == null
}

function syntheticGrantForCold(params: { ownerId: string; askerId: string; privacyPolicy?: string }): BrainQueryGrantRow {
  const privacy_policy =
    typeof params.privacyPolicy === 'string' && params.privacyPolicy.trim().length > 0
      ? params.privacyPolicy.trim()
      : DEFAULT_BRAIN_QUERY_PRIVACY_POLICY
  return {
    id: 'cold_query_synthetic',
    owner_id: params.ownerId,
    asker_id: params.askerId,
    privacy_policy,
    policy: 'review',
    created_at_ms: 0,
    updated_at_ms: 0,
    revoked_at_ms: null,
  }
}

async function lastAssistantMessage(sessionId: string): Promise<ChatMessage | null> {
  const doc = await loadSession(sessionId)
  if (!doc) return null
  for (let i = doc.messages.length - 1; i >= 0; i--) {
    const msg = doc.messages[i]
    if (msg?.role === 'assistant') return msg
  }
  return null
}

async function pushAssistantToColdOutbound(params: {
  askerTenantId: string
  outboundSessionId: string
  inboundSessionId: string
  text: string
}): Promise<void> {
  const askerCtx = await tenantContextForUser(params.askerTenantId)
  await runWithTenantContextAsync(askerCtx, async () => {
    const replaced = await replaceLastAwaitingPeerReviewOutboundAssistant({
      sessionId: params.outboundSessionId,
      text: params.text,
    })
    if (!replaced) {
      await appendTurn({
        sessionId: params.outboundSessionId,
        userMessage: null,
        assistantMessage: {
          role: 'assistant',
          content: params.text,
          parts: [{ type: 'text', content: params.text }],
        },
      })
    }
    await createNotification({
      sourceKind: 'b2b_tunnel_outbound_updated',
      idempotencyKey: `b2b_tunnel_out:${params.inboundSessionId}`,
      payload: {
        grantId: '',
        outboundSessionId: params.outboundSessionId,
        inboundSessionId: params.inboundSessionId,
      },
    })
  })
}

async function appendAssistantToAsker(
  grant: BrainQueryGrantRow,
  text: string,
  inboundTraceSessionId: string,
): Promise<void> {
  const trace = inboundTraceSessionId.trim()
  const askerCtx = await tenantContextForUser(grant.asker_id)
  const owner = await displayNameForUser(grant.owner_id)
  await runWithTenantContextAsync(askerCtx, async () => {
    let outbound = await findB2BSession(grant.id, 'b2b_outbound')
    if (!outbound) {
      const sid = randomUUID()
      await ensureSessionStub(sid, {
        sessionType: 'b2b_outbound',
        remoteGrantId: grant.id,
        remoteHandle: owner.handle,
        remoteDisplayName: owner.displayName,
      })
      outbound = await findB2BSession(grant.id, 'b2b_outbound')
    }
    if (!outbound || !trace) return
    const replaced = await replaceLastAwaitingPeerReviewOutboundAssistant({
      sessionId: outbound.sessionId,
      text,
    })
    if (!replaced) {
      await appendTurn({
        sessionId: outbound.sessionId,
        userMessage: null,
        assistantMessage: { role: 'assistant', content: text, parts: [{ type: 'text', content: text }] },
      })
    }
    await createNotification({
      sourceKind: 'b2b_tunnel_outbound_updated',
      idempotencyKey: `b2b_tunnel_out:${trace}`,
      payload: {
        grantId: grant.id,
        outboundSessionId: outbound.sessionId,
        inboundSessionId: trace,
      },
    })
  })
}

export async function runB2BQueryForGrant(params: {
  grant: BrainQueryGrantRow
  message: string
  ownerDisplayName: string
  ownerHandle: string
  askerDisplayName: string
  askerHandle: string
  timezone?: string
}): Promise<{ answer: string; inboundSessionId: string; releaseToAsker: boolean }> {
  const { grant, message } = params
  const auto = grantRowAutoSendEnabled(grant)
  const ownerCtx = await tenantContextForUser(grant.owner_id)
  return runWithTenantContextAsync(ownerCtx, async () => {
    // Each query gets its own inbound session so each question appears as a separate inbox item.
    const sessionId = randomUUID()
    await ensureSessionStub(sessionId, {
      sessionType: 'b2b_inbound',
      remoteGrantId: grant.id,
      remoteHandle: params.askerHandle,
      remoteDisplayName: params.askerDisplayName,
      approvalState: auto ? 'auto' : 'pending',
    })
    const inbound = { sessionId }

    const agent = createB2BAgent(grant, wikiDir(), {
      ownerDisplayName: params.ownerDisplayName,
      ownerHandle: params.ownerHandle,
      timezone: params.timezone,
      promptClock: { tenantUserId: grant.owner_id },
    })
    const draft = await promptB2BAgentForText(agent, message)
    const answer = await filterB2BResponse({ privacyPolicy: grant.privacy_policy, draftAnswer: draft })
    await appendTurn({
      sessionId: inbound.sessionId,
      userMessage: message,
      assistantMessage: { role: 'assistant', content: answer, parts: [{ type: 'text', content: answer }] },
    })
    await updateApprovalState(inbound.sessionId, auto ? 'auto' : 'pending')
    await createNotificationForTenant(grant.owner_id, {
      sourceKind: 'b2b_inbound_query',
      payload: {
        grantId: grant.id,
        b2bSessionId: inbound.sessionId,
        peerUserId: grant.asker_id,
        peerHandle: params.askerHandle,
        peerDisplayName: params.askerDisplayName,
        question: message,
        pendingReview: !auto,
      },
    })
    return { answer, inboundSessionId: inbound.sessionId, releaseToAsker: auto }
  })
}

/** Owner: resolve chat-native inbound thread for a grant (or null if none yet). */
b2bChat.get('/inbound-session/:grantId', async (c) => {
  const ctx = getTenantContext()
  const grantId = c.req.param('grantId')?.trim() ?? ''
  if (!grantId) return c.json({ error: 'grantId_required' }, 400)

  const grant = getBrainQueryGrantById(grantId)
  if (!grant || grant.owner_id !== ctx.tenantUserId) {
    return c.json({ error: 'not_found' }, 404)
  }

  const inbound = await findB2BSession(grant.id, 'b2b_inbound')
  return c.json({ sessionId: inbound?.sessionId ?? null })
})

b2bChat.get('/tunnels', async (c) => {
  const ctx = getTenantContext()
  const grants = listBrainQueryGrantsForAsker(ctx.tenantUserId)
  const tunnels: TunnelApi[] = []
  for (const grant of grants) {
    const owner = await displayNameForUser(grant.owner_id)
    const existing = await findB2BSession(grant.id, 'b2b_outbound')
    tunnels.push({
      grantId: grant.id,
      ownerId: grant.owner_id,
      ownerHandle: owner.handle,
      ownerDisplayName: owner.displayName,
      sessionId: existing?.sessionId ?? null,
    })
  }
  return c.json({ tunnels })
})

/** Create outbound chat session stub for a grant when the sidebar opens an empty tunnel. */
b2bChat.post('/ensure-session', async (c) => {
  const ctx = getTenantContext()
  let body: { grantId?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const grantId = typeof body.grantId === 'string' ? body.grantId.trim() : ''
  if (!grantId) return c.json({ error: 'grantId_required' }, 400)

  const grant = getBrainQueryGrantById(grantId)
  if (!grantIsActiveForAsker(grant, ctx.tenantUserId)) {
    return c.json({ error: 'grant_not_found_or_revoked' }, 403)
  }

  const owner = await displayNameForUser(grant.owner_id)
  let outbound = await findB2BSession(grant.id, 'b2b_outbound')
  if (!outbound) {
    await ensureSessionStub(randomUUID(), {
      sessionType: 'b2b_outbound',
      remoteGrantId: grant.id,
      remoteHandle: owner.handle,
      remoteDisplayName: owner.displayName,
    })
    outbound = await findB2BSession(grant.id, 'b2b_outbound')
  }
  if (!outbound) return c.json({ error: 'outbound_session_create_failed' }, 500)

  return c.json({ sessionId: outbound.sessionId })
})

b2bChat.post('/send', async (c) => {
  const ctx = getTenantContext()
  let body: { grantId?: unknown; message?: unknown; timezone?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const grantId = typeof body.grantId === 'string' ? body.grantId.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  if (!grantId) return c.json({ error: 'grantId_required' }, 400)
  if (!message) return c.json({ error: 'message_required' }, 400)

  const grant = getBrainQueryGrantById(grantId)
  if (!grantIsActiveForAsker(grant, ctx.tenantUserId)) {
    return c.json({ error: 'grant_not_found_or_revoked' }, 403)
  }
  if (grantRowIgnoresInbound(grant)) {
    return c.json({ error: 'grant_ignored' }, 403)
  }

  const owner = await displayNameForUser(grant.owner_id)
  const asker = { handle: ctx.workspaceHandle, displayName: ctx.workspaceHandle }
  let outbound = await findB2BSession(grant.id, 'b2b_outbound')
  if (!outbound) {
    await ensureSessionStub(randomUUID(), {
      sessionType: 'b2b_outbound',
      remoteGrantId: grant.id,
      remoteHandle: owner.handle,
      remoteDisplayName: owner.displayName,
    })
    outbound = await findB2BSession(grant.id, 'b2b_outbound')
  }
  if (!outbound) return c.json({ error: 'outbound_session_create_failed' }, 500)

  const result = await runB2BQueryForGrant({
    grant,
    message,
    ownerDisplayName: owner.displayName,
    ownerHandle: owner.handle,
    askerDisplayName: asker.displayName,
    askerHandle: asker.handle,
    timezone,
  })

  if (result.releaseToAsker) {
    return streamStaticAssistantSse(c, {
      announceSessionId: outbound.sessionId,
      text: result.answer,
      userMessageForPersistence: message,
      onTurnComplete: async ({ userMessage, assistantMessage }) => {
        await appendTurn({ sessionId: outbound.sessionId, userMessage, assistantMessage })
      },
    })
  }

  const placeholder = B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT
  return streamStaticAssistantSse(c, {
    announceSessionId: outbound.sessionId,
    text: placeholder,
    userMessageForPersistence: message,
    onTurnComplete: async ({ userMessage: _userMessage }) => {
      await appendTurn({
        sessionId: outbound.sessionId,
        userMessage: message,
        assistantMessage: {
          role: 'assistant',
          content: placeholder,
          parts: [{ type: 'text', content: placeholder }],
          b2bDelivery: 'awaiting_peer_review',
        },
      })
    },
  })
})

b2bChat.post('/approve', async (c) => {
  const ctx = getTenantContext()
  let body: { sessionId?: unknown; editedAnswer?: unknown; establishPolicy?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) return c.json({ error: 'sessionId_required' }, 400)
  const session = await loadSession(sessionId)
  if (!session || session.sessionType !== 'b2b_inbound') {
    return c.json({ error: 'not_found' }, 404)
  }

  const edited = typeof body.editedAnswer === 'string' ? body.editedAnswer.trim() : ''
  const draft = edited || (await lastAssistantMessage(sessionId))?.content?.trim() || ''
  if (!draft) return c.json({ error: 'draft_not_found' }, 400)

  const cold =
    session.isColdQuery === true &&
    (session.remoteGrantId == null || session.remoteGrantId === '') &&
    typeof session.coldPeerUserId === 'string' &&
    session.coldPeerUserId.trim().length > 0

  if (cold) {
    const rawPol = body.establishPolicy
    const establishPolicy: BrainQueryGrantPolicy =
      rawPol === 'auto' || rawPol === 'review' || rawPol === 'ignore' ? rawPol : 'review'
    if (establishPolicy === 'ignore') {
      return c.json({ error: 'cannot_approve_with_ignore' }, 400)
    }
    if (session.approvalState !== 'pending') {
      return c.json({ error: 'not_pending' }, 400)
    }
    const outboundSid = (session.coldLinkedSessionId ?? '').trim()
    if (!outboundSid) return c.json({ error: 'cold_link_missing' }, 500)

    const grant = createBrainQueryGrant({
      ownerId: ctx.tenantUserId,
      askerId: session.coldPeerUserId!.trim(),
      policy: establishPolicy,
    })
    finalizeColdSessionWithGrant(sessionId, grant.id)
    const askerId = session.coldPeerUserId!.trim()
    const askerCtx = await tenantContextForUser(askerId)
    await runWithTenantContextAsync(askerCtx, async () => {
      finalizeColdSessionWithGrant(outboundSid, grant.id)
    })
    await updateApprovalState(sessionId, 'approved')
    await appendAssistantToAsker(grant, draft, sessionId)
    return c.json({ ok: true, grantId: grant.id })
  }

  if (!session.remoteGrantId) return c.json({ error: 'not_found' }, 404)
  const grant = getBrainQueryGrantById(session.remoteGrantId)
  if (!grant || grant.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
  await updateApprovalState(sessionId, 'approved')
  await appendAssistantToAsker(grant, draft, sessionId)
  return c.json({ ok: true })
})

b2bChat.post('/decline', async (c) => {
  const ctx = getTenantContext()
  let body: { sessionId?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) return c.json({ error: 'sessionId_required' }, 400)
  const session = await loadSession(sessionId)
  if (!session || session.sessionType !== 'b2b_inbound') {
    return c.json({ error: 'not_found' }, 404)
  }

  const declineText = "I can't answer that from the access currently granted."

  const cold =
    session.isColdQuery === true &&
    (session.remoteGrantId == null || session.remoteGrantId === '') &&
    typeof session.coldPeerUserId === 'string' &&
    session.coldPeerUserId.trim().length > 0 &&
    typeof session.coldLinkedSessionId === 'string' &&
    session.coldLinkedSessionId.trim().length > 0

  if (cold) {
    await updateApprovalState(sessionId, 'declined')
    await pushAssistantToColdOutbound({
      askerTenantId: session.coldPeerUserId!.trim(),
      outboundSessionId: session.coldLinkedSessionId!.trim(),
      inboundSessionId: sessionId,
      text: declineText,
    })
    return c.json({ ok: true })
  }

  if (!session.remoteGrantId) return c.json({ error: 'not_found' }, 404)
  const grant = getBrainQueryGrantById(session.remoteGrantId)
  if (!grant || grant.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
  await updateApprovalState(sessionId, 'declined')
  await appendAssistantToAsker(grant, declineText, sessionId)
  return c.json({ ok: true })
})

b2bChat.post('/dismiss', async (c) => {
  const ctx = getTenantContext()
  let body: { sessionId?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) return c.json({ error: 'sessionId_required' }, 400)
  const session = await loadSession(sessionId)
  if (!session || session.sessionType !== 'b2b_inbound') {
    return c.json({ error: 'not_found' }, 404)
  }
  if (session.approvalState !== 'pending') {
    return c.json({ error: 'not_pending' }, 400)
  }

  const cold =
    session.isColdQuery === true && (session.remoteGrantId == null || session.remoteGrantId === '')
  if (!cold) {
    if (!session.remoteGrantId) return c.json({ error: 'not_found' }, 404)
    const grant = getBrainQueryGrantById(session.remoteGrantId)
    if (!grant || grant.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
  } else if (!(session.coldPeerUserId?.trim())) {
    return c.json({ error: 'not_found' }, 404)
  }

  await updateApprovalState(sessionId, 'dismissed')
  return c.json({ ok: true })
})

b2bChat.get('/review', async (c) => {
  const raw = (c.req.query('state') ?? 'pending').trim().toLowerCase()
  const stateFilter = raw === 'sent' ? 'sent' : raw === 'all' ? 'all' : 'pending'
  const rows = await listB2BInboundReviewRows({ stateFilter })
  return c.json({
    items: rows.map((r) => ({
      sessionId: r.sessionId,
      grantId: r.grantId,
      isColdQuery: r.isColdQuery,
      policy: r.policy,
      peerHandle: r.peerHandle,
      peerDisplayName: r.peerDisplayName,
      askerSnippet: r.askerSnippet,
      draftSnippet: r.draftSnippet,
      state: r.rowState === 'approved' ? 'sent' : r.rowState,
      updatedAtMs: r.updatedAtMs,
    })),
  })
})

b2bChat.patch('/grants/:grantId', async (c) => {
  const ctx = getTenantContext()
  const grantId = c.req.param('grantId')?.trim() ?? ''
  if (!grantId) return c.json({ error: 'grantId_required' }, 400)
  let body: { policy?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const policy = body.policy
  if (policy !== 'auto' && policy !== 'review' && policy !== 'ignore') {
    return c.json({ error: 'policy_invalid' }, 400)
  }
  const grant = getBrainQueryGrantById(grantId)
  if (!grant || grant.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
  const updated = setBrainQueryGrantPolicy({
    grantId,
    ownerId: ctx.tenantUserId,
    policy,
  })
  if (!updated) return c.json({ error: 'update_failed' }, 500)

  const pending = listPendingInboundSessionIdsForGrant(grantId)
  if (policy === 'auto') {
    for (const sid of pending) {
      const s = await loadSession(sid)
      if (!s || s.approvalState !== 'pending') continue
      const draft = (await lastAssistantMessage(sid))?.content?.trim() || ''
      if (!draft) continue
      await updateApprovalState(sid, 'approved')
      await appendAssistantToAsker(updated, draft, sid)
    }
  } else if (policy === 'ignore') {
    for (const sid of pending) {
      const s = await loadSession(sid)
      if (s?.approvalState === 'pending') await updateApprovalState(sid, 'dismissed')
    }
  }

  return c.json({
    ok: true,
    policy: updated.policy,
    autoSend: updated.policy === 'auto',
  })
})

b2bChat.patch('/grants/:grantId/auto-send', async (c) => {
  const ctx = getTenantContext()
  const grantId = c.req.param('grantId')?.trim() ?? ''
  if (!grantId) return c.json({ error: 'grantId_required' }, 400)
  let body: { autoSend?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  if (typeof body.autoSend !== 'boolean') {
    return c.json({ error: 'autoSend_boolean_required' }, 400)
  }
  const grant = getBrainQueryGrantById(grantId)
  if (!grant || grant.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
  const updated = setBrainQueryGrantPolicy({
    grantId,
    ownerId: ctx.tenantUserId,
    policy: body.autoSend ? 'auto' : 'review',
  })
  if (!updated) return c.json({ error: 'update_failed' }, 500)
  return c.json({ ok: true, autoSend: updated.policy === 'auto', policy: updated.policy })
})

b2bChat.post('/regenerate', async (c) => {
  const ctx = getTenantContext()
  let body: { sessionId?: unknown; notes?: unknown; timezone?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) return c.json({ error: 'sessionId_required' }, 400)

  const session = await loadSession(sessionId)
  if (!session || session.sessionType !== 'b2b_inbound') {
    return c.json({ error: 'not_found' }, 404)
  }
  if (session.approvalState !== 'pending') {
    return c.json({ error: 'not_pending' }, 400)
  }

  const cold =
    session.isColdQuery === true &&
    (session.remoteGrantId == null || session.remoteGrantId === '') &&
    typeof session.coldPeerUserId === 'string' &&
    session.coldPeerUserId.trim().length > 0

  let grant: BrainQueryGrantRow
  if (cold) {
    grant = syntheticGrantForCold({ ownerId: ctx.tenantUserId, askerId: session.coldPeerUserId!.trim() })
  } else {
    if (!session.remoteGrantId) return c.json({ error: 'not_found' }, 404)
    const g = getBrainQueryGrantById(session.remoteGrantId)
    if (!g || g.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
    grant = g
  }

  let lastUser = ''
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i]
    if (m?.role === 'user' && (m.content ?? '').trim()) {
      lastUser = (m.content ?? '').trim()
      break
    }
  }
  if (!lastUser) return c.json({ error: 'no_user_message' }, 400)

  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const augmented =
    notes.length > 0 ? `${lastUser}\n\n[Instructions for your draft: ${notes}]` : lastUser
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined

  const owner = await displayNameForUser(grant.owner_id)
  const ownerCtx = await tenantContextForUser(grant.owner_id)
  const answer = await runWithTenantContextAsync(ownerCtx, async () => {
    const agent = createB2BAgent(grant, wikiDir(), {
      ownerDisplayName: owner.displayName,
      ownerHandle: owner.handle,
      timezone,
      promptClock: { tenantUserId: grant.owner_id },
    })
    const draft = await promptB2BAgentForText(agent, augmented)
    return filterB2BResponse({ privacyPolicy: grant.privacy_policy, draftAnswer: draft })
  })

  const ok = await replaceLastAssistantMessageInSession(sessionId, {
    role: 'assistant',
    content: answer,
    parts: [{ type: 'text', content: answer }],
  })
  if (!ok) return c.json({ error: 'replace_failed' }, 500)
  return c.json({ ok: true, draft: answer })
})

b2bChat.post('/cold-query', async (c) => {
  const ctx = getTenantContext()
  let body: {
    targetHandle?: unknown
    targetEmail?: unknown
    targetUserId?: unknown
    message?: unknown
    timezone?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const targetHandle = typeof body.targetHandle === 'string' ? body.targetHandle.trim() : ''
  const targetEmail = typeof body.targetEmail === 'string' ? body.targetEmail.trim() : ''
  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  const modes = [targetHandle, targetEmail, targetUserId].filter((s) => s.length > 0)
  if (modes.length === 0) {
    return c.json({ error: 'target_required', message: 'Provide targetHandle, targetEmail, or targetUserId.' }, 400)
  }
  if (modes.length > 1) {
    return c.json(
      { error: 'target_ambiguous', message: 'Provide only one of targetHandle, targetEmail, or targetUserId.' },
      400,
    )
  }
  if (!message) return c.json({ error: 'message_required' }, 400)

  let target =
    targetUserId.length > 0
      ? await resolveConfirmedTenantEntry({ userId: targetUserId, excludeUserId: ctx.tenantUserId })
      : null
  if (!target && targetEmail.length > 0) {
    const uid = await resolveUserIdByPrimaryEmail({ email: targetEmail, excludeUserId: ctx.tenantUserId })
    if (uid) target = await resolveConfirmedTenantEntry({ userId: uid, excludeUserId: ctx.tenantUserId })
  }
  if (!target && targetHandle.length > 0) {
    target = await resolveConfirmedHandle({ handle: targetHandle, excludeUserId: ctx.tenantUserId })
  }
  if (!target) return c.json({ error: 'target_not_found' }, 404)

  const existing = getActiveBrainQueryGrant({ ownerId: target.userId, askerId: ctx.tenantUserId })
  if (existing) {
    return c.json({ error: 'grant_exists', grantId: existing.id }, 409)
  }

  const rate = assertColdQueryRateAllowed({
    senderHandle: ctx.workspaceHandle,
    receiverHandle: target.handle,
  })
  if (!rate.ok) {
    return c.json({ error: 'cold_query_rate_limited', retryAfterMs: Math.ceil(rate.retryAfterMs) }, 429)
  }

  const sender = await displayNameForUser(ctx.tenantUserId)
  const receiver = { handle: target.handle, displayName: target.displayName ?? target.handle }
  const outboundId = randomUUID()
  const inboundId = randomUUID()

  const senderCtx = await tenantContextForUser(ctx.tenantUserId)
  await runWithTenantContextAsync(senderCtx, async () => {
    await ensureSessionStub(outboundId, {
      sessionType: 'b2b_outbound',
      remoteGrantId: null,
      isColdQuery: true,
      coldPeerUserId: target.userId,
      coldLinkedSessionId: inboundId,
      remoteHandle: receiver.handle,
      remoteDisplayName: receiver.displayName,
    })
  })

  const recvCtx = await tenantContextForUser(target.userId)
  const syn = syntheticGrantForCold({ ownerId: target.userId, askerId: ctx.tenantUserId })

  await runWithTenantContextAsync(recvCtx, async () => {
    await ensureSessionStub(inboundId, {
      sessionType: 'b2b_inbound',
      remoteGrantId: null,
      isColdQuery: true,
      coldPeerUserId: ctx.tenantUserId,
      coldLinkedSessionId: outboundId,
      remoteHandle: sender.handle,
      remoteDisplayName: sender.displayName,
      approvalState: 'pending',
    })
    const ownerVis = await displayNameForUser(target.userId)
    const agent = createB2BAgent(syn, wikiDir(), {
      ownerDisplayName: ownerVis.displayName,
      ownerHandle: ownerVis.handle,
      timezone,
      promptClock: { tenantUserId: target.userId },
    })
    const draft = await promptB2BAgentForText(agent, message)
    const answer = await filterB2BResponse({ privacyPolicy: syn.privacy_policy, draftAnswer: draft })
    await appendTurn({
      sessionId: inboundId,
      userMessage: message,
      assistantMessage: { role: 'assistant', content: answer, parts: [{ type: 'text', content: answer }] },
    })
    await updateApprovalState(inboundId, 'pending')
    await createNotificationForTenant(target.userId, {
      sourceKind: 'b2b_inbound_query',
      payload: {
        grantId: null,
        b2bSessionId: inboundId,
        peerUserId: ctx.tenantUserId,
        peerHandle: sender.handle,
        peerDisplayName: sender.displayName,
        question: message,
        pendingReview: true,
        coldQuery: true,
      },
    })
  })

  await runWithTenantContextAsync(senderCtx, async () => {
    const placeholder = B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT
    await appendTurn({
      sessionId: outboundId,
      userMessage: message,
      assistantMessage: {
        role: 'assistant',
        content: placeholder,
        parts: [{ type: 'text', content: placeholder }],
        b2bDelivery: 'awaiting_peer_review',
      },
    })
  })

  recordColdQuerySent({ senderHandle: ctx.workspaceHandle, receiverHandle: target.handle })

  return c.json({ sessionId: outboundId, inboundSessionId: inboundId })
})

export default b2bChat
