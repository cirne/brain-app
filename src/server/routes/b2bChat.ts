import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { getTenantContext, runWithTenantContextAsync, type TenantContext } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import {
  getBrainQueryGrantById,
  listBrainQueryGrantsForAsker,
  type BrainQueryGrantRow,
} from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import {
  appendTurn,
  ensureSessionStub,
  findB2BSession,
  loadSession,
  updateApprovalState,
} from '@server/lib/chat/chatStorage.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { createB2BAgent, filterB2BResponse, promptB2BAgentForText } from '@server/agent/b2bAgent.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { streamStaticAssistantSse } from '@server/lib/chat/streamAgentSse.js'
import { createNotificationForTenant } from '@server/lib/notifications/createNotificationForTenant.js'

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

async function lastAssistantMessage(sessionId: string): Promise<ChatMessage | null> {
  const doc = await loadSession(sessionId)
  if (!doc) return null
  for (let i = doc.messages.length - 1; i >= 0; i--) {
    const msg = doc.messages[i]
    if (msg?.role === 'assistant') return msg
  }
  return null
}

async function appendAssistantToAsker(grant: BrainQueryGrantRow, text: string): Promise<void> {
  const askerCtx = await tenantContextForUser(grant.asker_id)
  const owner = await displayNameForUser(grant.owner_id)
  await runWithTenantContextAsync(askerCtx, async () => {
    let outbound = await findB2BSession(grant.id, 'b2b_outbound')
    if (!outbound) {
      const sessionId = randomUUID()
      await ensureSessionStub(sessionId, {
        sessionType: 'b2b_outbound',
        remoteGrantId: grant.id,
        remoteHandle: owner.handle,
        remoteDisplayName: owner.displayName,
      })
      outbound = await findB2BSession(grant.id, 'b2b_outbound')
    }
    if (!outbound) return
    await appendTurn({
      sessionId: outbound.sessionId,
      userMessage: null,
      assistantMessage: { role: 'assistant', content: text, parts: [{ type: 'text', content: text }] },
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
}): Promise<{ answer: string; inboundSessionId: string }> {
  const { grant, message } = params
  const ownerCtx = await tenantContextForUser(grant.owner_id)
  return runWithTenantContextAsync(ownerCtx, async () => {
    let inbound = await findB2BSession(grant.id, 'b2b_inbound')
    if (!inbound) {
      const sessionId = randomUUID()
      await ensureSessionStub(sessionId, {
        sessionType: 'b2b_inbound',
        remoteGrantId: grant.id,
        remoteHandle: params.askerHandle,
        remoteDisplayName: params.askerDisplayName,
        approvalState: 'auto',
      })
      inbound = await findB2BSession(grant.id, 'b2b_inbound')
    }
    if (!inbound) throw new Error('inbound_session_create_failed')

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
    await updateApprovalState(inbound.sessionId, 'auto')
    await createNotificationForTenant(grant.owner_id, {
      sourceKind: 'b2b_inbound_query',
      payload: {
        grantId: grant.id,
        b2bSessionId: inbound.sessionId,
        peerUserId: grant.asker_id,
        peerHandle: params.askerHandle,
        peerDisplayName: params.askerDisplayName,
        question: message,
      },
    })
    return { answer, inboundSessionId: inbound.sessionId }
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

  const { answer } = await runB2BQueryForGrant({
    grant,
    message,
    ownerDisplayName: owner.displayName,
    ownerHandle: owner.handle,
    askerDisplayName: asker.displayName,
    askerHandle: asker.handle,
    timezone,
  })

  return streamStaticAssistantSse(c, {
    announceSessionId: outbound.sessionId,
    text: answer,
    userMessageForPersistence: message,
    onTurnComplete: async ({ userMessage, assistantMessage }) => {
      await appendTurn({ sessionId: outbound.sessionId, userMessage, assistantMessage })
    },
  })
})

b2bChat.post('/approve', async (c) => {
  const ctx = getTenantContext()
  let body: { sessionId?: unknown; editedAnswer?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) return c.json({ error: 'sessionId_required' }, 400)
  const session = await loadSession(sessionId)
  if (!session || session.sessionType !== 'b2b_inbound' || !session.remoteGrantId) {
    return c.json({ error: 'not_found' }, 404)
  }
  const grant = getBrainQueryGrantById(session.remoteGrantId)
  if (!grant || grant.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
  const edited = typeof body.editedAnswer === 'string' ? body.editedAnswer.trim() : ''
  const draft = edited || (await lastAssistantMessage(sessionId))?.content?.trim() || ''
  if (!draft) return c.json({ error: 'draft_not_found' }, 400)
  await updateApprovalState(sessionId, 'approved')
  await appendAssistantToAsker(grant, draft)
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
  if (!session || session.sessionType !== 'b2b_inbound' || !session.remoteGrantId) {
    return c.json({ error: 'not_found' }, 404)
  }
  const grant = getBrainQueryGrantById(session.remoteGrantId)
  if (!grant || grant.owner_id !== ctx.tenantUserId) return c.json({ error: 'not_found' }, 404)
  await updateApprovalState(sessionId, 'declined')
  await appendAssistantToAsker(grant, "I can't answer that from the access currently granted.")
  return c.json({ ok: true })
})

export default b2bChat
