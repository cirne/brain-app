import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { deleteSession } from '../agent/index.js'
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
  listBrainQueryGrantsForOwner,
  revokeBrainQueryGrantAsAsker,
  setBrainQueryGrantPolicy,
  type BrainQueryGrantPolicy,
  type BrainQueryGrantRow,
} from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { DEFAULT_BRAIN_QUERY_PRIVACY_POLICY } from '@server/lib/brainQuery/defaultPrivacyPolicy.js'
import {
  appendTurn,
  deleteSessionFile,
  ensureSessionStub,
  findB2BSession,
  listColdOutboundSessionIdsForPeer,
  latestColdOutboundSessionForPeer,
  listDistinctColdOutboundPeerUserIds,
  listDistinctColdInboundPeerUserIds,
  listPendingColdInboundPairsForPeerAsker,
  loadSession,
  listB2BInboundReviewRows,
  listPendingInboundSessionIdsForGrant,
  replaceLastAssistantMessageInSession,
  replaceLastAwaitingPeerReviewOutboundAssistant,
  updateApprovalState,
  finalizeColdSessionWithGrant,
  getInboundB2bSessionPeerMeta,
  listColdInboundSessionsForPeer,
  listInboundSessionsForGrant,
  listTimelineMessages,
} from '@server/lib/chat/chatStorage.js'
import {
  resolveConfirmedHandle,
  resolveConfirmedTenantEntry,
  resolveUserIdByPrimaryEmail,
} from '@server/lib/tenant/workspaceHandleDirectory.js'
import {
  assertColdQueryRateAllowed,
  deleteColdQueryRateLimitRow,
  recordColdQuerySent,
} from '@server/lib/global/coldQueryRateLimits.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { createB2BAgent, filterB2BResponse, promptB2BAgentForText } from '@server/agent/b2bAgent.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { streamStaticAssistantSse } from '@server/lib/chat/streamAgentSse.js'
import { createNotificationForTenant } from '@server/lib/notifications/createNotificationForTenant.js'
import { deleteOwnerInboundForRevokedBrainQueryGrant } from '@server/lib/chat/brainTunnelInboundCleanup.js'
import {
  createNotification,
  deleteNotificationsForB2bInboundSessionId,
  deleteNotificationsForB2bOutboundTunnelRefs,
} from '@server/lib/notifications/notificationsRepo.js'
import { notifyBrainTunnelActivity, notifyBrainTunnelActivityForWorkspace } from '@server/lib/hub/hubSseBroker.js'
import {
  B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT,
  B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT,
} from '@shared/b2bTunnelDelivery.js'
import type { TunnelTimelineEntryApi } from '@shared/tunnelTimeline.js'

const b2bChat = new Hono()

/** LLM + replace inbound placeholder; push tunnel_activity so open sidebars refetch review copy. */
async function deliverColdQueryInboundAssistantDraft(params: {
  recvCtx: TenantContext
  syn: BrainQueryGrantRow
  inboundId: string
  message: string
  targetUserId: string
  timezone: string | undefined
}): Promise<void> {
  const { recvCtx, syn, inboundId, message, targetUserId, timezone } = params
  await runWithTenantContextAsync(recvCtx, async () => {
    try {
      const ownerVis = await displayNameForUser(targetUserId)
      const agent = createB2BAgent(syn, wikiDir(), {
        ownerDisplayName: ownerVis.displayName,
        ownerHandle: ownerVis.handle,
        timezone,
        promptClock: { tenantUserId: targetUserId },
      })
      const draft = await promptB2BAgentForText(agent, message)
      const answer = await filterB2BResponse({ privacyPolicy: syn.privacy_policy, draftAnswer: draft })
      await replaceLastAssistantMessageInSession(inboundId, {
        role: 'assistant',
        content: answer,
        parts: [{ type: 'text', content: answer }],
      })
    } catch (err) {
      console.warn('[cold-query] inbound draft failed', err)
      /** Persisted assistant text in the inbound review thread (English; visible in Review queue). */
      const errText =
        'Could not draft a suggested reply. You can still respond manually from the review queue.'
      await replaceLastAssistantMessageInSession(inboundId, {
        role: 'assistant',
        content: errText,
        parts: [{ type: 'text', content: errText }],
      })
    }
    await notifyBrainTunnelActivity(
      JSON.stringify({
        scope: 'inbox',
        inboundSessionId: inboundId,
        grantId: null,
      }),
    )
  })
}

async function coldQueryTunnelEvidenceExists(params: {
  senderCtx: TenantContext
  recvCtx: TenantContext
  askerUserId: string
  ownerUserId: string
}): Promise<boolean> {
  let pending = false
  await runWithTenantContextAsync(params.recvCtx, async () => {
    pending = listPendingColdInboundPairsForPeerAsker(params.askerUserId).length > 0
  })
  if (pending) return true
  let hasOutbound = false
  await runWithTenantContextAsync(params.senderCtx, async () => {
    hasOutbound = listColdOutboundSessionIdsForPeer(params.ownerUserId).length > 0
  })
  return hasOutbound
}

/** Drop pending cold handshakes from this asker so a new cold query can supersede the prior message. */
async function teardownPendingColdQuerySessionsBetweenPeers(params: {
  senderCtx: TenantContext
  recvCtx: TenantContext
  askerUserId: string
}): Promise<void> {
  const outboundIds = new Set<string>()

  await runWithTenantContextAsync(params.recvCtx, async () => {
    for (const p of listPendingColdInboundPairsForPeerAsker(params.askerUserId)) {
      deleteNotificationsForB2bInboundSessionId(p.inboundSessionId)
      await deleteSessionFile(p.inboundSessionId)
      if (p.outboundSessionId) outboundIds.add(p.outboundSessionId)
    }
  })

  await runWithTenantContextAsync(params.senderCtx, async () => {
    for (const oid of outboundIds) {
      const doc = await loadSession(oid)
      const inId =
        doc?.sessionType === 'b2b_outbound' && doc.isColdQuery === true
          ? (doc.coldLinkedSessionId ?? '').trim()
          : ''
      if (inId) {
        deleteNotificationsForB2bOutboundTunnelRefs({ outboundSessionId: oid, inboundSessionId: inId })
      }
      await deleteSessionFile(oid)
    }
  })
}

/** Tear down one pending cold-query pair (asker outbound + owner inbound) when the asker withdraws. */
async function teardownColdOutboundPairForWithdraw(params: {
  askerCtx: TenantContext
  outboundSessionId: string
  inboundSessionId: string
  receiverUserId: string
}): Promise<void> {
  const recvCtx = await tenantContextForUser(params.receiverUserId)
  await runWithTenantContextAsync(recvCtx, async () => {
    deleteNotificationsForB2bInboundSessionId(params.inboundSessionId)
    await deleteSessionFile(params.inboundSessionId)
  })
  await runWithTenantContextAsync(params.askerCtx, async () => {
    deleteNotificationsForB2bOutboundTunnelRefs({
      outboundSessionId: params.outboundSessionId,
      inboundSessionId: params.inboundSessionId,
    })
    deleteSession(params.outboundSessionId)
    await deleteSessionFile(params.outboundSessionId)
  })
}

type TunnelListRowApi = {
  /** Stable peer tenant id — used internally; callers may omit in UI lists. */
  peerUserId: string
  /** Outbound Brain tunnel (`asker=tenant`): query their brain via `ensure-session` + `send`. */
  outboundGrantId: string | null
  /** Inbound Brain tunnel (`owner=tenant`): policy + inbound review queues. */
  inboundGrantId: string | null
  /** Canonical URL segment for `/tunnels/:handle`; unique per collaborator. */
  peerHandle: string
  peerDisplayName: string
  outboundSessionId: string | null
  /** @deprecated Prefer `outboundGrantId`; kept for callers that expected one grant field. */
  grantId: string | null
  /** @deprecated Use `peerDisplayName`; kept for compat. */
  ownerDisplayName: string
  /** @deprecated Same as peerHandle; kept for compat. */
  ownerHandle: string
  ownerId: string
  /** @deprecated Use `outboundSessionId`; kept for compat. */
  sessionId: string | null
  lastActivityMs: number
  snippet: string
  pendingReviewCount: number
  inboundPolicy: BrainQueryGrantPolicy | null
}

function snippetOneLine(raw: string, max = 160): string {
  const line = raw.trim().split('\n')[0] ?? ''
  if (line.length <= max) return line
  return `${line.slice(0, Math.max(0, max - 3))}...`
}

function lastOutboundTurnSnippets(messages: ChatMessage[]): { query: string; reply: string } {
  let lastQuery = ''
  let lastAssist = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    lastQuery = (m.content ?? '').trim()
    break
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    const parts = m.parts?.find((p): p is { type: 'text'; content: string } => p.type === 'text' && !!p.content)
    lastAssist = (parts?.content ?? m.content ?? '').trim()
    break
  }
  return { query: snippetOneLine(lastQuery), reply: snippetOneLine(lastAssist) }
}

type TimelineCue = { ms: number; text: string }

async function tunnelActivitySnapshotForPeer(params: {
  peerUserId: string
  outboundGrant: BrainQueryGrantRow | null
  inboundGrant: BrainQueryGrantRow | null
}): Promise<{ lastMs: number; snippet: string; outboundSessionId: string | null; pendingReviewCount: number }> {
  const cues: TimelineCue[] = []
  let outboundSessionId: string | null = null
  const { peerUserId, outboundGrant, inboundGrant } = params

  if (outboundGrant) {
    cues.push({ ms: outboundGrant.updated_at_ms, text: '' })
    const ob = await findB2BSession(outboundGrant.id, 'b2b_outbound')
    outboundSessionId = ob?.sessionId ?? null
    if (ob?.sessionId) {
      const rows = listTimelineMessages(ob.sessionId)
      const lastRow = rows[rows.length - 1]
      if (lastRow) cues.push({ ms: lastRow.createdAtMs, text: '' })
      const msgDoc = await loadSession(ob.sessionId)
      if (msgDoc?.messages?.length) {
        const sn = lastOutboundTurnSnippets(msgDoc.messages)
        const awaiting = sn.reply.includes(B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT)
        const line = awaiting ? sn.query || sn.reply : sn.reply || sn.query || ''
        if (lastRow) cues.push({ ms: lastRow.createdAtMs, text: line })
        else cues.push({ ms: outboundGrant.updated_at_ms, text: line })
      }
    }
  }

  if (!outboundSessionId) {
    const cold = latestColdOutboundSessionForPeer(peerUserId)
    if (cold) {
      outboundSessionId = cold.sessionId
      cues.push({ ms: cold.updatedAtMs, text: '' })
      const tlRows = listTimelineMessages(cold.sessionId)
      const lastRow = tlRows[tlRows.length - 1]
      if (lastRow) cues.push({ ms: lastRow.createdAtMs, text: '' })
      const msgDoc = await loadSession(cold.sessionId)
      if (msgDoc?.messages?.length) {
        const sn = lastOutboundTurnSnippets(msgDoc.messages)
        const awaiting = sn.reply.includes(B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT)
        const line = awaiting ? sn.query || sn.reply : sn.reply || sn.query || ''
        if (lastRow) cues.push({ ms: lastRow.createdAtMs, text: line })
        else cues.push({ ms: cold.updatedAtMs, text: line })
      }
    }
  }

  let pendingReviewCount = 0
  if (inboundGrant) {
    cues.push({ ms: inboundGrant.updated_at_ms, text: '' })
    pendingReviewCount += listPendingInboundSessionIdsForGrant(inboundGrant.id).length
    for (const r of listInboundSessionsForGrant(inboundGrant.id)) {
      cues.push({ ms: r.updatedAtMs, text: '' })
      const rows = listTimelineMessages(r.sessionId)
      const lastTs = rows[rows.length - 1]?.createdAtMs ?? r.updatedAtMs
      const doc = await loadSession(r.sessionId)
      let ask = ''
      let draft = ''
      if (doc?.messages?.length) {
        for (const m of doc.messages) {
          if (m.role === 'user') ask = (m.content ?? '').trim()
          if (m.role === 'assistant') {
            const parts = m.parts?.find((p): p is { type: 'text'; content: string } => p.type === 'text' && !!p.content)
            draft = (parts?.content ?? m.content ?? '').trim()
          }
        }
      }
      const line = draft || ask || ''
      cues.push({ ms: lastTs, text: line })
    }
  }

  pendingReviewCount += listPendingColdInboundPairsForPeerAsker(peerUserId).length
  for (const r of listColdInboundSessionsForPeer(peerUserId)) {
    cues.push({ ms: r.updatedAtMs, text: '' })
    const rows = listTimelineMessages(r.sessionId)
    const lastTs = rows[rows.length - 1]?.createdAtMs ?? r.updatedAtMs
    const doc = await loadSession(r.sessionId)
    let ask = ''
    let draft = ''
    if (doc?.messages?.length) {
      for (const m of doc.messages) {
        if (m.role === 'user') ask = (m.content ?? '').trim()
        if (m.role === 'assistant') {
          const parts = m.parts?.find((p): p is { type: 'text'; content: string } => p.type === 'text' && !!p.content)
          draft = (parts?.content ?? m.content ?? '').trim()
        }
      }
    }
    const line = draft || ask || ''
    cues.push({ ms: lastTs, text: line })
  }

  const vis = await displayNameForUser(peerUserId)

  cues.sort((a, b) => (a.ms !== b.ms ? b.ms - a.ms : b.text.localeCompare(a.text)))

  let lastMs = 0
  for (const c of cues) {
    lastMs = Math.max(lastMs, c.ms > 0 ? c.ms : 0)
  }
  if (!lastMs && cues.length === 0) {
    cues.push({
      ms: Math.max(outboundGrant?.created_at_ms ?? 0, inboundGrant?.created_at_ms ?? 0),
      text: outboundGrant?.id ?? inboundGrant?.id ? vis.displayName : '',
    })
  }
  cues.sort((a, b) => b.ms - a.ms)
  const topMs = cues[0]?.ms ?? 0
  const snippetSource =
    cues.find((c) => c.ms === topMs && c.text.trim())?.text?.trim() ||
    cues.find((c) => c.text.trim())?.text.trim() ||
    ''
  let snippet =
    snippetSource.length > 0
      ? snippetOneLine(snippetSource)
      : outboundGrant ?? inboundGrant
        ? snippetOneLine(vis.displayName)
        : ''

  return { lastMs: topMs, snippet, outboundSessionId, pendingReviewCount }
}

async function buildMergedTunnelRowsForTenant(ctx: TenantContext): Promise<TunnelListRowApi[]> {
  const me = ctx.tenantUserId
  const merged = new Map<
    string,
    { outbound: BrainQueryGrantRow | null; inbound: BrainQueryGrantRow | null }
  >()

  for (const g of listBrainQueryGrantsForAsker(me)) {
    const prev = merged.get(g.owner_id) ?? { outbound: null, inbound: null }
    prev.outbound = g
    merged.set(g.owner_id, prev)
  }
  for (const g of listBrainQueryGrantsForOwner(me)) {
    const prev = merged.get(g.asker_id) ?? { outbound: null, inbound: null }
    prev.inbound = g
    merged.set(g.asker_id, prev)
  }

  for (const peerId of listDistinctColdOutboundPeerUserIds()) {
    if (!merged.has(peerId)) {
      merged.set(peerId, { outbound: null, inbound: null })
    }
  }

  for (const peerId of listDistinctColdInboundPeerUserIds()) {
    if (!merged.has(peerId)) {
      merged.set(peerId, { outbound: null, inbound: null })
    }
  }

  const rows: TunnelListRowApi[] = []
  for (const [peerUserId, acc] of merged) {
    const vis = await displayNameForUser(peerUserId)
    const snap = await tunnelActivitySnapshotForPeer({
      peerUserId,
      outboundGrant: acc.outbound,
      inboundGrant: acc.inbound,
    })
    const inboundPolicy = acc.inbound?.policy ?? null
    rows.push({
      peerUserId,
      outboundGrantId: acc.outbound?.id ?? null,
      inboundGrantId: acc.inbound?.id ?? null,
      peerHandle: vis.handle,
      peerDisplayName: vis.displayName,
      outboundSessionId: snap.outboundSessionId,
      grantId: acc.outbound?.id ?? null,
      ownerDisplayName: vis.displayName,
      ownerHandle: vis.handle,
      ownerId: peerUserId,
      sessionId: snap.outboundSessionId,
      lastActivityMs: snap.lastMs,
      snippet: snap.snippet,
      pendingReviewCount: snap.pendingReviewCount,
      inboundPolicy,
    })
  }

  rows.sort((a, b) => {
    if (b.lastActivityMs !== a.lastActivityMs) return b.lastActivityMs - a.lastActivityMs
    return (a.peerDisplayName || '').localeCompare(b.peerDisplayName || '', undefined, { sensitivity: 'base' })
  })
  return rows
}

function timelineMessagePlainText(msg: ChatMessage): string {
  const p = msg.parts?.find((q): q is { type: 'text'; content: string } => q.type === 'text' && !!q.content)
  return snippetOneLine((p?.content ?? msg.content ?? '').trim())
}

async function buildTunnelTimeline(params: {
  outboundGrant: BrainQueryGrantRow | null
  inboundGrant: BrainQueryGrantRow | null
  peerUserId: string
  peerVis: { handle: string; displayName: string }
}): Promise<TunnelTimelineEntryApi[]> {
  let insertOrd = 0
  const ordered: Array<{ entry: TunnelTimelineEntryApi; ord: number }> = []
  function pushTimeline(entry: TunnelTimelineEntryApi): void {
    ordered.push({ entry, ord: insertOrd++ })
  }

  const peerHandle = params.peerVis.handle
  const peerDisplayName = params.peerVis.displayName

  async function appendOutboundTimelineMessages(sessionId: string): Promise<void> {
    const rows = listTimelineMessages(sessionId)
    for (const r of rows) {
      const body = timelineMessagePlainText(r.message)
      if (!body) continue
      if (r.role === 'user') {
        pushTimeline({
          kind: 'message',
          id: `out:${sessionId}:${r.seq}`,
          atMs: r.createdAtMs,
          side: 'yours',
          actor: 'your_brain',
          body,
          hint: 'to_their_brain',
          chatSessionId: sessionId,
        })
      } else {
        pushTimeline({
          kind: 'message',
          id: `out:${sessionId}:a:${r.seq}`,
          atMs: r.createdAtMs,
          side: 'theirs',
          actor: 'their_brain',
          body,
          chatSessionId: sessionId,
        })
      }
    }
  }

  if (params.outboundGrant) {
    const ob = await findB2BSession(params.outboundGrant.id, 'b2b_outbound')
    const sid = ob?.sessionId
    if (sid) await appendOutboundTimelineMessages(sid)
  } else {
    const cold = latestColdOutboundSessionForPeer(params.peerUserId)
    if (cold?.sessionId) await appendOutboundTimelineMessages(cold.sessionId)
  }

  const inboundIdsOrdered: string[] = []
  const seen = new Set<string>()
  if (params.inboundGrant) {
    for (const row of listInboundSessionsForGrant(params.inboundGrant.id)) {
      if (seen.has(row.sessionId)) continue
      inboundIdsOrdered.push(row.sessionId)
      seen.add(row.sessionId)
    }
  }
  for (const row of listColdInboundSessionsForPeer(params.peerUserId)) {
    if (seen.has(row.sessionId)) continue
    inboundIdsOrdered.push(row.sessionId)
    seen.add(row.sessionId)
  }
  inboundIdsOrdered.sort((a, b) => {
    const ra = listTimelineMessages(a)[0]?.createdAtMs ?? 0
    const rb = listTimelineMessages(b)[0]?.createdAtMs ?? 0
    return ra - rb
  })

  for (const inboundSid of inboundIdsOrdered) {
    const doc = await loadSession(inboundSid)
    if (!doc || doc.sessionType !== 'b2b_inbound') continue
    if (doc.approvalState === 'dismissed') continue

    const rows = listTimelineMessages(inboundSid)
    const firstUserRow = rows.find((r) => r.role === 'user')
    if (firstUserRow) {
      const q = timelineMessagePlainText(firstUserRow.message)
      if (q) {
        pushTimeline({
          kind: 'message',
          id: `in:${inboundSid}:q:${firstUserRow.seq}`,
          atMs: firstUserRow.createdAtMs,
          side: 'theirs',
          actor: 'their_brain',
          body: q,
        })
      }
    }

    let lastAssistRow = null as null | (typeof rows)[number]
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.role === 'assistant') {
        lastAssistRow = rows[i]!
        break
      }
    }

    const grantIdNorm = typeof doc.remoteGrantId === 'string' ? doc.remoteGrantId.trim() : ''
    const grantSnap = grantIdNorm ? getBrainQueryGrantById(grantIdNorm) : null
    const policySnap = grantSnap?.policy ?? null
    const isColdInbound = !!(doc.isColdQuery === true && !grantSnap)

    const st = doc.approvalState ?? 'pending'
    const draftSnippet = lastAssistRow ? timelineMessagePlainText(lastAssistRow.message) : ''
    const askerSnippet = firstUserRow ? timelineMessagePlainText(firstUserRow.message) : ''
    const sessionWallMs = new Date(doc.updatedAt).getTime()
    const updatedAtMsRaw = rows[rows.length - 1]?.createdAtMs ?? sessionWallMs

    if (st === 'pending') {
      pushTimeline({
        kind: 'pending_review',
        id: `pend:${inboundSid}`,
        atMs: lastAssistRow?.createdAtMs ?? firstUserRow?.createdAtMs ?? updatedAtMsRaw,
        sessionId: inboundSid,
        grantId: grantSnap?.id ?? null,
        isColdQuery: isColdInbound,
        policy: policySnap,
        peerHandle,
        peerDisplayName,
        askerSnippet,
        draftSnippet,
        state: 'pending',
        updatedAtMs: updatedAtMsRaw,
      })
      continue
    }

    if (draftSnippet.trim().length === 0) continue
    const draftingLc = B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT.toLowerCase()
    if (draftSnippet.trim().toLowerCase() === draftingLc) continue

    const assistMs = lastAssistRow?.createdAtMs ?? 0
    const userMs = firstUserRow?.createdAtMs ?? 0
    /** Prefer wall/session update time so “sent after review” beats same-ms insert + id tie-break quirks. */
    const answerAtMs = Math.max(assistMs, userMs, sessionWallMs)

    pushTimeline({
      kind: 'message',
      id: `in:${inboundSid}:a:${lastAssistRow?.seq ?? rows.length}`,
      atMs: answerAtMs,
      side: 'yours',
      actor: 'your_brain',
      body: draftSnippet,
      hint: st === 'auto' ? 'auto_sent' : undefined,
    })
  }

  ordered.sort((a, b) => {
    if (a.entry.atMs !== b.entry.atMs) return a.entry.atMs - b.entry.atMs
    return a.ord - b.ord
  })
  return ordered.map((o) => o.entry)
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
  const tunnels = await buildMergedTunnelRowsForTenant(ctx)
  return c.json({ tunnels })
})

/** Resolve `/review/:sessionId` deep links → `/tunnels/:handle`. */
b2bChat.get('/peer-handle-for-review/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')?.trim() ?? ''
  if (!sessionId) return c.json({ error: 'sessionId_required' }, 400)
  const meta = getInboundB2bSessionPeerMeta(sessionId)
  if (!meta) return c.json({ error: 'not_found' }, 404)
  let tunnelHandle =
    typeof meta.peerHandle === 'string' && meta.peerHandle.trim().length > 0
      ? meta.peerHandle.trim()
      : ''
  if (!tunnelHandle && typeof meta.coldPeerUserId === 'string' && meta.coldPeerUserId.trim().length > 0) {
    const vis = await displayNameForUser(meta.coldPeerUserId.trim())
    tunnelHandle = vis.handle
  }
  if (!tunnelHandle) return c.json({ error: 'peer_unresolved' }, 404)
  return c.json({ tunnelHandle })
})

/** Unified tunnel activity timeline for `/tunnels/:handle` detail pane. */
b2bChat.get('/tunnel-timeline/:handle', async (c) => {
  const ctx = getTenantContext()
  let rawSeg = (c.req.param('handle') ?? '').trim()
  try {
    rawSeg = decodeURIComponent(rawSeg).trim()
  } catch {
    /* keep raw */
  }
  if (!rawSeg) return c.json({ error: 'handle_required' }, 400)

  const resolved = await resolveConfirmedHandle({ handle: rawSeg, excludeUserId: ctx.tenantUserId })
  if (!resolved?.userId) return c.json({ error: 'not_found' }, 404)
  const peerUserId = resolved.userId

  const peerVis = await displayNameForUser(peerUserId)
  const outboundGrant = getActiveBrainQueryGrant({ ownerId: peerUserId, askerId: ctx.tenantUserId })
  const inboundGrant = getActiveBrainQueryGrant({ ownerId: ctx.tenantUserId, askerId: peerUserId })

  const hasColdInbound = listColdInboundSessionsForPeer(peerUserId).length > 0
  const hasColdOutbound = listColdOutboundSessionIdsForPeer(peerUserId).length > 0
  if (!outboundGrant && !inboundGrant && !hasColdInbound && !hasColdOutbound) {
    return c.json({ error: 'tunnel_not_found' }, 404)
  }

  const timeline = await buildTunnelTimeline({
    outboundGrant,
    inboundGrant,
    peerUserId,
    peerVis,
  })

  return c.json({
    peerUserId,
    outboundGrantId: outboundGrant?.id ?? null,
    inboundGrantId: inboundGrant?.id ?? null,
    peerHandle: peerVis.handle,
    peerDisplayName: peerVis.displayName,
    inboundPolicy: inboundGrant?.policy ?? null,
    timeline,
  })
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

/** Asker: revoke Brain tunnel access and remove outbound session (and pending cold peer inbound). */
b2bChat.post('/withdraw-as-asker', async (c) => {
  const ctx = getTenantContext()
  let body: { sessionId?: unknown; grantId?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const grantIdOnly = typeof body.grantId === 'string' ? body.grantId.trim() : ''
  if (sessionId && grantIdOnly) {
    return c.json({ error: 'session_or_grant_exclusive' }, 400)
  }
  if (!sessionId && !grantIdOnly) {
    return c.json({ error: 'session_or_grant_required' }, 400)
  }

  if (sessionId) {
    const doc = await loadSession(sessionId)
    if (!doc || doc.sessionType !== 'b2b_outbound') {
      return c.json({ error: 'not_found' }, 404)
    }

    const cold =
      doc.isColdQuery === true &&
      (!(doc.remoteGrantId ?? '').trim()) &&
      (doc.coldLinkedSessionId ?? '').trim().length > 0 &&
      (doc.coldPeerUserId ?? '').trim().length > 0

    if (cold) {
      await teardownColdOutboundPairForWithdraw({
        askerCtx: ctx,
        outboundSessionId: sessionId,
        inboundSessionId: doc.coldLinkedSessionId!.trim(),
        receiverUserId: doc.coldPeerUserId!.trim(),
      })
      return c.json({ ok: true as const })
    }

    const gid = (doc.remoteGrantId ?? '').trim()
    if (gid) {
      const grantSnap = getBrainQueryGrantById(gid)
      revokeBrainQueryGrantAsAsker({ grantId: gid, askerId: ctx.tenantUserId })
      if (grantSnap?.asker_id === ctx.tenantUserId) {
        await deleteOwnerInboundForRevokedBrainQueryGrant(grantSnap)
      }
    }
    deleteSession(sessionId)
    await deleteSessionFile(sessionId)
    return c.json({ ok: true as const })
  }

  const grant = getBrainQueryGrantById(grantIdOnly)
  if (!grant || grant.asker_id !== ctx.tenantUserId) {
    return c.json({ error: 'not_found' }, 404)
  }
  revokeBrainQueryGrantAsAsker({ grantId: grant.id, askerId: ctx.tenantUserId })
  await deleteOwnerInboundForRevokedBrainQueryGrant(grant)
  const outbound = await findB2BSession(grant.id, 'b2b_outbound')
  if (outbound?.sessionId) {
    deleteSession(outbound.sessionId)
    await deleteSessionFile(outbound.sessionId)
  }
  return c.json({ ok: true as const })
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
    doneB2bDelivery: 'awaiting_peer_review',
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

  const senderCtx = await tenantContextForUser(ctx.tenantUserId)
  const recvCtx = await tenantContextForUser(target.userId)

  await teardownPendingColdQuerySessionsBetweenPeers({
    senderCtx,
    recvCtx,
    askerUserId: ctx.tenantUserId,
  })

  let rate = assertColdQueryRateAllowed({
    senderHandle: ctx.workspaceHandle,
    receiverHandle: target.handle,
  })
  if (!rate.ok) {
    const stillThere = await coldQueryTunnelEvidenceExists({
      senderCtx,
      recvCtx,
      askerUserId: ctx.tenantUserId,
      ownerUserId: target.userId,
    })
    if (!stillThere) {
      deleteColdQueryRateLimitRow({
        senderHandle: ctx.workspaceHandle,
        receiverHandle: target.handle,
      })
      rate = assertColdQueryRateAllowed({
        senderHandle: ctx.workspaceHandle,
        receiverHandle: target.handle,
      })
    }
  }
  if (!rate.ok) {
    return c.json({ error: 'cold_query_rate_limited', retryAfterMs: Math.ceil(rate.retryAfterMs) }, 429)
  }

  const sender = await displayNameForUser(ctx.tenantUserId)
  const receiver = { handle: target.handle, displayName: target.displayName ?? target.handle }
  const outboundId = randomUUID()
  const inboundId = randomUUID()
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
    const drafting = B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT
    await appendTurn({
      sessionId: inboundId,
      userMessage: message,
      assistantMessage: {
        role: 'assistant',
        content: drafting,
        parts: [{ type: 'text', content: drafting }],
      },
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
    /** Explicit workspace: ensures recipient rail refetches even if ALS context skew during async hops. */
    await notifyBrainTunnelActivityForWorkspace(
      recvCtx.workspaceHandle,
      JSON.stringify({
        scope: 'inbox',
        inboundSessionId: inboundId,
        grantId: null,
      }),
    )
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

  void deliverColdQueryInboundAssistantDraft({
    recvCtx,
    syn,
    inboundId,
    message,
    targetUserId: target.userId,
    timezone,
  }).catch((err) => {
    console.warn('[cold-query] background delivery task failed', err)
  })

  return c.json({ sessionId: outboundId, inboundSessionId: inboundId })
})

export default b2bChat
