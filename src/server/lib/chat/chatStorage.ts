import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { deleteSession } from '@server/agent/index.js'
import type { ApprovalState, ChatMessage, ChatSessionDocV1, ChatSessionType } from './chatTypes.js'
import { chatDataDirResolved } from '@server/lib/platform/brainHome.js'
import { getTenantDb } from '@server/lib/tenant/tenantSqlite.js'
import { getBrainQueryGrantById } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import type { BrainQueryGrantPolicy } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import {
  deleteB2bInboundQueryNotificationsForGrantId,
  deleteNotificationsForB2bInboundSessionId,
} from '@server/lib/notifications/notificationsRepo.js'
import { notifyBrainTunnelActivity } from '@server/lib/hub/hubSseBroker.js'

type TenantDb = ReturnType<typeof getTenantDb>

export const chatDataDir = () => chatDataDirResolved()

export function isChatSessionDocV1(x: unknown): x is ChatSessionDocV1 {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    o.version === 1 &&
    typeof o.sessionId === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.updatedAt === 'string' &&
    (o.title === null || typeof o.title === 'string') &&
    Array.isArray(o.messages)
  )
}

function ensureChatMessageId(
  msg: ChatMessage | (Omit<ChatMessage, 'id'> & { id?: string }),
): ChatMessage {
  const id = typeof msg.id === 'string' && msg.id.length > 0 ? msg.id : randomUUID()
  return { ...msg, id }
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString()
}

export async function ensureChatDir(): Promise<string> {
  const dir = chatDataDir()
  await mkdir(dir, { recursive: true })
  return dir
}

export async function findFilenameForSession(sessionId: string): Promise<string | null> {
  const db = getTenantDb()
  const row = db
    .prepare(
      `SELECT session_id as sessionId, created_at_ms as createdAtMs FROM chat_sessions WHERE lower(session_id) = lower(?)`,
    )
    .get(sessionId) as { sessionId: string; createdAtMs: number } | undefined
  if (!row) return null
  return `${row.createdAtMs}-${row.sessionId}.json`
}

function parseMessages(rows: { seq: number; role: string; content_json: string; created_at_ms: number }[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content_json) as ChatMessage
      out.push(ensureChatMessageId(parsed))
    } catch {
      /* skip corrupt row */
    }
  }
  return out
}

export async function loadSession(sessionId: string): Promise<ChatSessionDocV1 | null> {
  const db = getTenantDb()
  const sess = db
    .prepare(
      `SELECT session_id, title, preview, session_type, remote_grant_id, remote_handle, remote_display_name,
        approval_state, expects_response, is_cold_query, cold_peer_user_id, cold_linked_session_id, created_at_ms, updated_at_ms
       FROM chat_sessions WHERE lower(session_id) = lower(?)`,
    )
    .get(sessionId) as ChatSessionRow | undefined
  if (!sess) return null
  const msgRows = db
    .prepare(
      `SELECT seq, role, content_json, created_at_ms FROM chat_messages WHERE session_id = ? ORDER BY seq ASC`,
    )
    .all(sess.session_id) as { seq: number; role: string; content_json: string; created_at_ms: number }[]
  const messages = parseMessages(msgRows)
  const isCold = sess.is_cold_query === 1
  return {
    version: 1,
    sessionId: sess.session_id,
    createdAt: msToIso(sess.created_at_ms),
    updatedAt: msToIso(sess.updated_at_ms),
    title: sess.title,
    sessionType: sess.session_type,
    remoteGrantId: sess.remote_grant_id,
    remoteHandle: sess.remote_handle,
    remoteDisplayName: sess.remote_display_name,
    approvalState: sess.approval_state,
    ...(isCold
      ? {
          isColdQuery: true as const,
          coldPeerUserId: sess.cold_peer_user_id,
          coldLinkedSessionId: sess.cold_linked_session_id,
        }
      : {}),
    expectsResponse: sessionExpectsResponseFromRow(sess),
    messages,
  }
}

export type ChatSessionListItem = {
  sessionId: string
  createdAt: string
  updatedAt: string
  title: string | null
  preview?: string
  sessionType: ChatSessionType
  remoteGrantId: string | null
  remoteHandle: string | null
  remoteDisplayName: string | null
  approvalState: ApprovalState | null
}

type ChatSessionRow = {
  session_id: string
  title: string | null
  preview: string | null
  session_type: ChatSessionType
  remote_grant_id: string | null
  remote_handle: string | null
  remote_display_name: string | null
  approval_state: ApprovalState | null
  expects_response: number
  is_cold_query: number
  cold_peer_user_id: string | null
  cold_linked_session_id: string | null
  created_at_ms: number
  updated_at_ms: number
}

export type EnsureSessionStubOptions = {
  sessionType?: ChatSessionType
  remoteGrantId?: string | null
  remoteHandle?: string | null
  remoteDisplayName?: string | null
  approvalState?: ApprovalState | null
  /** When true with {@link coldPeerUserId}, allows `remoteGrantId` null for cold-query handshake (OPP-112). */
  isColdQuery?: boolean
  coldPeerUserId?: string | null
  coldLinkedSessionId?: string | null
  /** B2B inbound: false when preflight says peer message is FYI (default true). */
  expectsResponse?: boolean
}

function sessionExpectsResponseFromRow(r: { expects_response?: number }): boolean {
  return r.expects_response !== 0
}

function rowToListItem(r: ChatSessionRow, preview?: string): ChatSessionListItem {
  return {
    sessionId: r.session_id,
    createdAt: msToIso(r.created_at_ms),
    updatedAt: msToIso(r.updated_at_ms),
    title: r.title,
    preview,
    sessionType: r.session_type,
    remoteGrantId: r.remote_grant_id,
    remoteHandle: r.remote_handle,
    remoteDisplayName: r.remote_display_name,
    approvalState: r.approval_state,
  }
}

function firstAssistantPreviewLine(messages: ChatMessage[]): string | undefined {
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const fromParts = m.parts?.find((p): p is { type: 'text'; content: string } => p.type === 'text' && !!p.content)
    const raw = (fromParts?.content ?? m.content ?? '').trim()
    const line = raw.split('\n')[0] ?? ''
    if (line) return line.length > 120 ? `${line.slice(0, 117)}...` : line
  }
  return undefined
}

function previewFromMessages(messages: ChatMessage[]): string | undefined {
  const u = messages.find(m => m.role === 'user')
  if (u?.content?.trim()) {
    const line = u.content.trim().split('\n')[0] ?? ''
    if (line) return line.length > 120 ? `${line.slice(0, 117)}...` : line
  }
  return firstAssistantPreviewLine(messages)
}

function recomputePreview(db: TenantDb, sessionId: string): string | null {
  const msgRows = db
    .prepare(`SELECT content_json FROM chat_messages WHERE session_id = ? ORDER BY seq ASC`)
    .all(sessionId) as { content_json: string }[]
  const messages: ChatMessage[] = []
  for (const r of msgRows) {
    try {
      messages.push(ensureChatMessageId(JSON.parse(r.content_json) as ChatMessage))
    } catch {
      /* skip */
    }
  }
  const p = previewFromMessages(messages)
  return p ?? null
}

/**
 * @param limit — when set to a positive integer, return at most that many sessions (newest first).
 *   Omit or non-positive for no cap (full list).
 */
export async function listSessions(limit?: number): Promise<ChatSessionListItem[]> {
  const db = getTenantDb()
  const cap = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined
  const projection = `session_id, title, preview, session_type, remote_grant_id, remote_handle, remote_display_name,
    approval_state, expects_response, is_cold_query, cold_peer_user_id, cold_linked_session_id, created_at_ms, updated_at_ms`
  const sql =
    cap !== undefined
      ? `SELECT ${projection} FROM chat_sessions ORDER BY updated_at_ms DESC LIMIT ?`
      : `SELECT ${projection} FROM chat_sessions ORDER BY updated_at_ms DESC`
  const rows =
    cap !== undefined ? (db.prepare(sql).all(cap) as ChatSessionRow[]) : (db.prepare(sql).all() as ChatSessionRow[])

  return rows.map(r => {
    let preview = r.preview ?? undefined
    if (preview === undefined || preview === '') {
      const msgRows = db
        .prepare(`SELECT content_json FROM chat_messages WHERE session_id = ? ORDER BY seq ASC`)
        .all(r.session_id) as { content_json: string }[]
      const messages: ChatMessage[] = []
      for (const m of msgRows) {
        try {
          messages.push(ensureChatMessageId(JSON.parse(m.content_json) as ChatMessage))
        } catch {
          /* skip */
        }
      }
      preview = previewFromMessages(messages)
    }
    return rowToListItem(r, preview)
  })
}

/** Create an on-disk session file with no messages so GET /api/chat/sessions lists it immediately. */
export async function ensureSessionStub(sessionId: string, options: EnsureSessionStubOptions = {}): Promise<void> {
  await ensureChatDir()
  const db = getTenantDb()
  const now = Date.now()
  const existing = db.prepare(`SELECT session_id FROM chat_sessions WHERE lower(session_id) = lower(?)`).get(sessionId)
  if (existing) return
  const sessionType = options.sessionType ?? 'own'
  const remoteGrantId = options.remoteGrantId?.trim() || null
  const isCold = options.isColdQuery === true
  const coldPeer = options.coldPeerUserId?.trim() || null
  if (sessionType !== 'own' && remoteGrantId === null && !(isCold && coldPeer)) {
    throw new Error('remote_grant_id_required_for_b2b_session')
  }
  const coldLink = options.coldLinkedSessionId?.trim() || null
  const coldFlag = isCold ? 1 : 0
  const expectsResponse = options.expectsResponse === false ? 0 : 1
  db.prepare(
    `INSERT INTO chat_sessions (
       session_id, title, preview, session_type, remote_grant_id, remote_handle, remote_display_name,
       approval_state, expects_response, is_cold_query, cold_peer_user_id, cold_linked_session_id, created_at_ms, updated_at_ms
     ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    sessionType,
    remoteGrantId,
    options.remoteHandle?.trim() || null,
    options.remoteDisplayName?.trim() || null,
    options.approvalState ?? null,
    expectsResponse,
    coldFlag,
    coldPeer,
    coldLink,
    now,
    now,
  )
}

export async function findB2BSession(
  remoteGrantId: string,
  sessionType: Extract<ChatSessionType, 'b2b_outbound' | 'b2b_inbound'>,
): Promise<ChatSessionListItem | null> {
  const grantId = remoteGrantId.trim()
  if (!grantId) return null
  const db = getTenantDb()
  const row = db
    .prepare(
      `SELECT session_id, title, preview, session_type, remote_grant_id, remote_handle, remote_display_name,
        approval_state, expects_response, is_cold_query, cold_peer_user_id, cold_linked_session_id, created_at_ms, updated_at_ms
       FROM chat_sessions
       WHERE session_type = ? AND remote_grant_id = ?
       LIMIT 1`,
    )
    .get(sessionType, grantId) as ChatSessionRow | undefined
  if (!row) return null
  return rowToListItem(row, row.preview ?? undefined)
}

/** Owner-tenant inbound rows for `remote_grant_id` (one row per inbound question). Chronological oldest-first. */
export function listInboundSessionsForGrant(
  remoteGrantId: string,
): Array<{ sessionId: string; updatedAtMs: number }> {
  const db = getTenantDb()
  const gid = remoteGrantId.trim()
  if (!gid) return []
  const rows = db
    .prepare(
      `SELECT session_id, updated_at_ms FROM chat_sessions
       WHERE session_type = 'b2b_inbound' AND remote_grant_id = ?
       ORDER BY updated_at_ms ASC`,
    )
    .all(gid) as { session_id: string; updated_at_ms: number }[]
  return rows.map((r) => ({ sessionId: r.session_id, updatedAtMs: r.updated_at_ms }))
}

/** Cold-query inbound handshake rows from peer `coldPeerUserId` (pre-grant); oldest-first by update time. */
export function listColdInboundSessionsForPeer(
  coldPeerUserId: string,
): Array<{ sessionId: string; updatedAtMs: number }> {
  const db = getTenantDb()
  const peer = coldPeerUserId.trim()
  if (!peer) return []
  const rows = db
    .prepare(
      `SELECT session_id, updated_at_ms FROM chat_sessions
       WHERE session_type = 'b2b_inbound'
         AND is_cold_query = 1
         AND (remote_grant_id IS NULL OR trim(remote_grant_id) = '')
         AND lower(cold_peer_user_id) = lower(?)
       ORDER BY updated_at_ms ASC`,
    )
    .all(peer) as { session_id: string; updated_at_ms: number }[]
  return rows.map((r) => ({ sessionId: r.session_id, updatedAtMs: r.updated_at_ms }))
}

export type B2bInboundPeerMetaRow = {
  sessionId: string
  peerHandle: string | null
  peerDisplayName: string | null
  coldPeerUserId: string | null
}

export function getInboundB2bSessionPeerMeta(sessionId: string): B2bInboundPeerMetaRow | null {
  const db = getTenantDb()
  const sid = sessionId.trim()
  if (!sid) return null
  const row = db
    .prepare(
      `SELECT session_id, remote_handle, remote_display_name, cold_peer_user_id FROM chat_sessions
       WHERE session_type = 'b2b_inbound' AND lower(session_id) = lower(?)`,
    )
    .get(sid) as
    | {
        session_id: string
        remote_handle: string | null
        remote_display_name: string | null
        cold_peer_user_id: string | null
      }
    | undefined
  if (!row) return null
  return {
    sessionId: row.session_id,
    peerHandle: row.remote_handle?.trim() || null,
    peerDisplayName: row.remote_display_name?.trim() || null,
    coldPeerUserId: row.cold_peer_user_id?.trim() || null,
  }
}

/** Messages with persisted row timestamps — for chronological tunnel timelines across sessions. */
export type TimelineMessageRow = {
  seq: number
  role: 'user' | 'assistant'
  message: ChatMessage
  createdAtMs: number
}

export function listTimelineMessages(sessionId: string): TimelineMessageRow[] {
  const db = getTenantDb()
  const sid = sessionId.trim()
  if (!sid) return []
  const msgRows = db
    .prepare(
      `SELECT seq, role, content_json, created_at_ms FROM chat_messages WHERE session_id = ? ORDER BY seq ASC`,
    )
    .all(sid) as { seq: number; role: string; content_json: string; created_at_ms: number }[]
  const out: TimelineMessageRow[] = []
  for (const r of msgRows) {
    if (r.role !== 'user' && r.role !== 'assistant') continue
    try {
      const message = JSON.parse(r.content_json) as ChatMessage
      out.push({
        seq: r.seq,
        role: r.role,
        message: ensureChatMessageId(message),
        createdAtMs: r.created_at_ms,
      })
    } catch {
      /* skip */
    }
  }
  return out
}

/** Pending cold-query inbound from a specific asker (`cold_peer_user_id`). */
export function listPendingColdInboundPairsForPeerAsker(
  coldPeerUserId: string,
): { inboundSessionId: string; outboundSessionId: string | null }[] {
  const db = getTenantDb()
  const peer = coldPeerUserId.trim()
  if (!peer) return []
  const rows = db
    .prepare(
      `SELECT session_id, cold_linked_session_id
       FROM chat_sessions
       WHERE session_type = 'b2b_inbound'
         AND is_cold_query = 1
         AND (remote_grant_id IS NULL OR remote_grant_id = '')
         AND lower(cold_peer_user_id) = lower(?)
         AND approval_state = 'pending'`,
    )
    .all(peer) as { session_id: string; cold_linked_session_id: string | null }[]
  return rows.map(r => ({
    inboundSessionId: r.session_id,
    outboundSessionId: r.cold_linked_session_id?.trim() || null,
  }))
}

/** Cold outbound sessions to this peer (includes orphans after one-sided wipes). */
export function listColdOutboundSessionIdsForPeer(coldPeerUserId: string): string[] {
  const db = getTenantDb()
  const peer = coldPeerUserId.trim()
  if (!peer) return []
  const rows = db
    .prepare(
      `SELECT session_id FROM chat_sessions
       WHERE session_type = 'b2b_outbound'
         AND is_cold_query = 1
         AND lower(cold_peer_user_id) = lower(?)`,
    )
    .all(peer) as { session_id: string }[]
  return rows.map(r => r.session_id)
}

/** Latest cold-query outbound to `coldPeerUserId` (current tenant = asker); for tunnel list / timeline. */
export function latestColdOutboundSessionForPeer(coldPeerUserId: string): {
  sessionId: string
  updatedAtMs: number
} | null {
  const db = getTenantDb()
  const peer = coldPeerUserId.trim()
  if (!peer) return null
  const row = db
    .prepare(
      `SELECT session_id, updated_at_ms FROM chat_sessions
       WHERE session_type = 'b2b_outbound'
         AND is_cold_query = 1
         AND lower(cold_peer_user_id) = lower(?)
       ORDER BY updated_at_ms DESC
       LIMIT 1`,
    )
    .get(peer) as { session_id: string; updated_at_ms: number } | undefined
  if (!row?.session_id) return null
  return { sessionId: row.session_id, updatedAtMs: row.updated_at_ms }
}

/** Distinct cold-query outbound peers (`cold_peer_user_id`) on the current tenant DB. */
export function listDistinctColdOutboundPeerUserIds(): string[] {
  const db = getTenantDb()
  const rows = db
    .prepare(
      `SELECT DISTINCT trim(cold_peer_user_id) AS p FROM chat_sessions
       WHERE session_type = 'b2b_outbound'
         AND is_cold_query = 1
         AND cold_peer_user_id IS NOT NULL
         AND trim(cold_peer_user_id) != ''`,
    )
    .all() as { p: string }[]
  return rows.map(r => String(r.p).trim()).filter(Boolean)
}

/** Distinct cold-query inbound askers (`cold_peer_user_id`) on the current tenant DB (recipient side). */
export function listDistinctColdInboundPeerUserIds(): string[] {
  const db = getTenantDb()
  const rows = db
    .prepare(
      `SELECT DISTINCT trim(cold_peer_user_id) AS p FROM chat_sessions
       WHERE session_type = 'b2b_inbound'
         AND is_cold_query = 1
         AND cold_peer_user_id IS NOT NULL
         AND trim(cold_peer_user_id) != ''`,
    )
    .all() as { p: string }[]
  return rows.map(r => String(r.p).trim()).filter(Boolean)
}

export async function updateApprovalState(sessionId: string, state: ApprovalState): Promise<boolean> {
  const db = getTenantDb()
  const now = Date.now()
  const r = db
    .prepare(
      `UPDATE chat_sessions
       SET approval_state = ?, updated_at_ms = ?
       WHERE lower(session_id) = lower(?) AND session_type = 'b2b_inbound'`,
    )
    .run(state, now, sessionId)
  return r.changes > 0
}

/** Replace the latest assistant row when it is a tunnel outbound placeholder (OPP-111). */
export async function replaceLastAwaitingPeerReviewOutboundAssistant(params: {
  sessionId: string
  text: string
}): Promise<boolean> {
  const db = getTenantDb()
  const sid = params.sessionId
  const row = db
    .prepare(
      `SELECT seq, content_json FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1`,
    )
    .get(sid) as { seq: number; content_json: string } | undefined
  if (!row) return false
  let prev: ChatMessage
  try {
    prev = JSON.parse(row.content_json) as ChatMessage
  } catch {
    return false
  }
  if (prev.b2bDelivery !== 'awaiting_peer_review') return false
  const text = params.text.trim()
  if (!text) return false
  const next: ChatMessage = {
    ...prev,
    role: 'assistant',
    content: text,
    parts: [{ type: 'text', content: text }],
    b2bDelivery: undefined,
  }
  const now = Date.now()
  /** Delivery time so tunnel timelines sort answers after asks when the row was merged in one appendTurn (`created_at_ms` collision). */
  db.prepare(`UPDATE chat_messages SET content_json = ?, created_at_ms = ? WHERE session_id = ? AND seq = ?`).run(
    JSON.stringify(ensureChatMessageId(next)),
    now,
    sid,
    row.seq,
  )
  const previewVal = recomputePreview(db, sid)
  db.prepare(`UPDATE chat_sessions SET preview = ?, updated_at_ms = ? WHERE session_id = ?`).run(
    previewVal,
    now,
    sid,
  )
  return true
}

/** Outbound tunnel: turn `awaiting_peer_review` placeholder into FYI terminal state (no substantive reply). */
export async function replaceLastAwaitingPeerReviewWithNoReplyExpected(sessionId: string): Promise<boolean> {
  return replaceLastAwaitingPeerReviewWithB2bDelivery(sessionId, 'no_reply_expected')
}

/** Outbound tunnel: turn `awaiting_peer_review` placeholder into dismissed terminal state. */
export async function replaceLastAwaitingPeerReviewWithDismissed(sessionId: string): Promise<boolean> {
  return replaceLastAwaitingPeerReviewWithB2bDelivery(sessionId, 'dismissed')
}

async function replaceLastAwaitingPeerReviewWithB2bDelivery(
  sessionId: string,
  delivery: 'no_reply_expected' | 'dismissed',
): Promise<boolean> {
  const db = getTenantDb()
  const sid = sessionId.trim()
  if (!sid) return false
  const row = db
    .prepare(
      `SELECT seq, content_json FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1`,
    )
    .get(sid) as { seq: number; content_json: string } | undefined
  if (!row) return false
  let prev: ChatMessage
  try {
    prev = JSON.parse(row.content_json) as ChatMessage
  } catch {
    return false
  }
  if (prev.b2bDelivery !== 'awaiting_peer_review') return false
  const next: ChatMessage = {
    ...prev,
    role: 'assistant',
    content: '',
    parts: undefined,
    b2bDelivery: delivery,
  }
  const now = Date.now()
  db.prepare(`UPDATE chat_messages SET content_json = ?, created_at_ms = ? WHERE session_id = ? AND seq = ?`).run(
    JSON.stringify(ensureChatMessageId(next)),
    now,
    sid,
    row.seq,
  )
  const previewVal = recomputePreview(db, sid)
  db.prepare(`UPDATE chat_sessions SET preview = ?, updated_at_ms = ? WHERE session_id = ?`).run(
    previewVal,
    now,
    sid,
  )
  return true
}

/** Replace the last assistant message (e.g. B2B regenerate while review is pending). */
export async function replaceLastAssistantMessageInSession(sessionId: string, assistantMessage: ChatMessage): Promise<boolean> {
  const db = getTenantDb()
  const row = db
    .prepare(
      `SELECT seq FROM chat_messages WHERE session_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1`,
    )
    .get(sessionId) as { seq: number } | undefined
  if (!row) return false
  const now = Date.now()
  const msg = ensureChatMessageId(assistantMessage)
  db.prepare(`UPDATE chat_messages SET content_json = ? WHERE session_id = ? AND seq = ?`).run(
    JSON.stringify(msg),
    sessionId,
    row.seq,
  )
  const previewVal = recomputePreview(db, sessionId)
  db.prepare(`UPDATE chat_sessions SET preview = ?, updated_at_ms = ? WHERE session_id = ?`).run(
    previewVal,
    now,
    sessionId,
  )
  return true
}

export type B2BInboundReviewRow = {
  sessionId: string
  /** Null when inbound is a cold query before grant handshake. */
  grantId: string | null
  isColdQuery: boolean
  peerHandle: string | null
  peerDisplayName: string | null
  askerSnippet: string
  draftSnippet: string
  rowState: ApprovalState
  updatedAtMs: number
  /** Grant policy when `grantId` is set; null for cold pre-handshake rows. */
  policy: BrainQueryGrantPolicy | null
  /** Preflight: false when peer message is FYI (no draft expected). */
  expectsResponse: boolean
}

function snippetFromPlainText(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  if (line.length > 160) return `${line.slice(0, 157)}...`
  return line
}

function draftSnippetFromAssistant(m: ChatMessage): string {
  const fromParts = m.parts?.find((p): p is { type: 'text'; content: string } => p.type === 'text' && !!p.content)
  const raw = (fromParts?.content ?? m.content ?? '').trim()
  return snippetFromPlainText(raw)
}

/** Established inbound (not cold handshaking) whose global grant row was removed — drop session + notifications so Inbox cannot show dead rows. */
export async function pruneB2bInboundRowOrphanEstablishedGrant(sessionId: string, grantId: string): Promise<void> {
  const gid = grantId.trim()
  const sid = sessionId.trim()
  if (!gid || !sid) return
  deleteNotificationsForB2bInboundSessionId(sid)
  deleteSession(sid)
  await deleteSessionFile(sid)
  deleteB2bInboundQueryNotificationsForGrantId(gid)
}

export async function listB2BInboundReviewRows(params: {
  stateFilter: 'pending' | 'sent' | 'all'
}): Promise<B2BInboundReviewRow[]> {
  const db = getTenantDb()
  const rows = db
    .prepare(
      `SELECT session_id, remote_grant_id, remote_handle, remote_display_name, approval_state, expects_response, updated_at_ms, is_cold_query
       FROM chat_sessions
       WHERE session_type = 'b2b_inbound'
       ORDER BY updated_at_ms DESC`,
    )
    .all() as {
    session_id: string
    remote_grant_id: string | null
    remote_handle: string | null
    remote_display_name: string | null
    approval_state: ApprovalState | null
    expects_response: number
    updated_at_ms: number
    is_cold_query: number
  }[]

  const out: B2BInboundReviewRow[] = []
  let orphansPruned = false
  for (const r of rows) {
    const st: ApprovalState = r.approval_state ?? 'pending'
    if (st === 'dismissed') continue
    if (st === 'no_response_expected') continue
    if (params.stateFilter === 'pending' && st !== 'pending') continue
    if (params.stateFilter === 'sent' && st !== 'approved' && st !== 'auto') continue
    const grantIdRaw = r.remote_grant_id?.trim() ?? ''
    const isCold = r.is_cold_query === 1
    if (!grantIdRaw && !isCold) continue

    const expectsResponse = sessionExpectsResponseFromRow(r)
    if (st === 'pending' && grantIdRaw.length > 0 && !expectsResponse) continue

    const msgRows = db
      .prepare(`SELECT role, content_json FROM chat_messages WHERE session_id = ? ORDER BY seq ASC`)
      .all(r.session_id) as { role: string; content_json: string }[]

    let lastUserText = ''
    let lastAssistant: ChatMessage | null = null
    for (const mr of msgRows) {
      try {
        const msg = JSON.parse(mr.content_json) as ChatMessage
        if (mr.role === 'user') lastUserText = msg.content ?? ''
        if (mr.role === 'assistant') lastAssistant = msg
      } catch {
        /* skip */
      }
    }

    const grantId = grantIdRaw.length > 0 ? grantIdRaw : null
    const grantRow = grantId ? getBrainQueryGrantById(grantId) : null
    if (!isCold && grantId && grantRow === null) {
      await pruneB2bInboundRowOrphanEstablishedGrant(r.session_id, grantIdRaw)
      orphansPruned = true
      continue
    }

    const policy = grantRow?.policy ?? null

    out.push({
      sessionId: r.session_id,
      grantId,
      isColdQuery: isCold,
      peerHandle: r.remote_handle,
      peerDisplayName: r.remote_display_name,
      askerSnippet: lastUserText ? snippetFromPlainText(lastUserText) : '',
      draftSnippet: lastAssistant ? draftSnippetFromAssistant(lastAssistant) : '',
      rowState: st,
      updatedAtMs: r.updated_at_ms,
      policy,
      expectsResponse,
    })
  }

  if (orphansPruned) {
    await notifyBrainTunnelActivity(JSON.stringify({ scope: 'inbox', grantId: null, inboundSessionId: null }))
  }

  if (params.stateFilter === 'pending') {
    out.sort((a, b) => a.updatedAtMs - b.updatedAtMs)
  } else {
    out.sort((a, b) => {
      if (a.rowState === 'pending' && b.rowState !== 'pending') return -1
      if (a.rowState !== 'pending' && b.rowState === 'pending') return 1
      return b.updatedAtMs - a.updatedAtMs
    })
  }
  return out
}

export function listPendingInboundSessionIdsForGrant(remoteGrantId: string): string[] {
  const db = getTenantDb()
  const gid = remoteGrantId.trim()
  if (!gid) return []
  const rows = db
    .prepare(
      `SELECT session_id FROM chat_sessions
       WHERE session_type = 'b2b_inbound' AND remote_grant_id = ? AND approval_state = 'pending'`,
    )
    .all(gid) as { session_id: string }[]
  return rows.map((r) => r.session_id)
}

/** Every `b2b_inbound` row for `remote_grant_id` (any approval state); used when the asker revokes the tunnel. */
export function listInboundSessionIdsForRemoteGrant(remoteGrantId: string): string[] {
  const db = getTenantDb()
  const gid = remoteGrantId.trim()
  if (!gid) return []
  const rows = db
    .prepare(
      `SELECT session_id FROM chat_sessions
       WHERE session_type = 'b2b_inbound' AND remote_grant_id = ?`,
    )
    .all(gid) as { session_id: string }[]
  return rows.map((r) => r.session_id)
}

export function setColdLinkedSessionId(sessionId: string, linkedSessionId: string): void {
  const db = getTenantDb()
  const now = Date.now()
  db.prepare(
    `UPDATE chat_sessions SET cold_linked_session_id = ?, updated_at_ms = ? WHERE lower(session_id) = lower(?)`,
  ).run(linkedSessionId.trim(), now, sessionId)
}

/** After cold-query handshake: attach real grant id and clear cold flags. */
export function finalizeColdSessionWithGrant(sessionId: string, grantId: string): void {
  const db = getTenantDb()
  const now = Date.now()
  db.prepare(
    `UPDATE chat_sessions SET remote_grant_id = ?, is_cold_query = 0, cold_peer_user_id = NULL, cold_linked_session_id = NULL, updated_at_ms = ?
     WHERE lower(session_id) = lower(?)`,
  ).run(grantId.trim(), now, sessionId)
}

/** Persist title as soon as set_chat_title runs (before the turn is saved). */
export async function patchSessionTitle(sessionId: string, title: string): Promise<void> {
  const t = title.trim().slice(0, 120)
  if (!t) return
  await ensureChatDir()
  const db = getTenantDb()
  const now = Date.now()
  const r = db
    .prepare(`UPDATE chat_sessions SET title = ?, updated_at_ms = ? WHERE lower(session_id) = lower(?)`)
    .run(t, now, sessionId)
  if (r.changes === 0) return
}

/**
 * Append one user + one assistant message to the session file (creates file on first turn).
 * @param title - When non-empty, sets session title (from set_chat_title).
 */
export async function appendTurn(params: {
  sessionId: string
  /** Null = assistant spoke first (no user row for this turn). */
  userMessage: string | null
  assistantMessage: ChatMessage
  title?: string | null
}): Promise<void> {
  const { sessionId, userMessage, assistantMessage } = params
  await ensureChatDir()
  const db = getTenantDb()
  const now = Date.now()

  db.transaction(() => {
    const sess = db
      .prepare(`SELECT session_id, title, created_at_ms FROM chat_sessions WHERE lower(session_id) = lower(?)`)
      .get(sessionId) as { session_id: string; title: string | null; created_at_ms: number } | undefined

    const assistant = ensureChatMessageId(assistantMessage)
    const titleParam = params.title

    if (sess) {
      const sid = sess.session_id
      const maxRow = db.prepare(`SELECT COALESCE(MAX(seq), -1) as m FROM chat_messages WHERE session_id = ?`).get(sid) as {
        m: number
      }
      let nextSeq = maxRow.m + 1
      if (userMessage !== null) {
        const userMsg: ChatMessage = { role: 'user', content: userMessage, id: randomUUID() }
        db.prepare(
          `INSERT INTO chat_messages (session_id, seq, role, content_json, created_at_ms) VALUES (?, ?, 'user', ?, ?)`,
        ).run(sid, nextSeq, JSON.stringify(userMsg), now)
        nextSeq += 1
      }
      db.prepare(
        `INSERT INTO chat_messages (session_id, seq, role, content_json, created_at_ms) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(sid, nextSeq, JSON.stringify(assistant), now)

      let title = sess.title
      if (typeof titleParam === 'string' && titleParam.trim() !== '') {
        title = titleParam.trim().slice(0, 120)
      }
      const previewVal = recomputePreview(db, sid)
      db.prepare(`UPDATE chat_sessions SET title = ?, preview = ?, updated_at_ms = ? WHERE session_id = ?`).run(
        title,
        previewVal,
        now,
        sid,
      )
    } else {
      const title =
        typeof titleParam === 'string' && titleParam.trim() !== '' ? titleParam.trim().slice(0, 120) : null
      db.prepare(
        `INSERT INTO chat_sessions (session_id, title, preview, created_at_ms, updated_at_ms)
         VALUES (?, ?, NULL, ?, ?)`,
      ).run(sessionId, title, now, now)

      let seq = 0
      if (userMessage !== null) {
        const userMsg: ChatMessage = { role: 'user', content: userMessage, id: randomUUID() }
        db.prepare(
          `INSERT INTO chat_messages (session_id, seq, role, content_json, created_at_ms) VALUES (?, ?, 'user', ?, ?)`,
        ).run(sessionId, seq, JSON.stringify(userMsg), now)
        seq += 1
      }
      db.prepare(
        `INSERT INTO chat_messages (session_id, seq, role, content_json, created_at_ms) VALUES (?, ?, 'assistant', ?, ?)`,
      ).run(sessionId, seq, JSON.stringify(assistant), now)

      const previewVal = recomputePreview(db, sessionId)
      db.prepare(`UPDATE chat_sessions SET preview = ? WHERE session_id = ?`).run(previewVal, sessionId)
    }
  })()
}

export async function deleteSessionFile(sessionId: string): Promise<boolean> {
  const db = getTenantDb()
  const r = db.prepare(`DELETE FROM chat_sessions WHERE lower(session_id) = lower(?)`).run(sessionId)
  return r.changes > 0
}

/** Remove all persisted chat sessions from tenant SQLite. Does not remove onboarding.json or other files under `chats/`. */
export async function deleteAllChatSessionFiles(): Promise<void> {
  const db = getTenantDb()
  db.prepare(`DELETE FROM chat_sessions`).run()
}
