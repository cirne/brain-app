import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { ApprovalState, ChatMessage, ChatSessionDocV1, ChatSessionType } from './chatTypes.js'
import { chatDataDirResolved } from '@server/lib/platform/brainHome.js'
import { getTenantDb } from '@server/lib/tenant/tenantSqlite.js'

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
        approval_state, created_at_ms, updated_at_ms
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
  created_at_ms: number
  updated_at_ms: number
}

export type EnsureSessionStubOptions = {
  sessionType?: ChatSessionType
  remoteGrantId?: string | null
  remoteHandle?: string | null
  remoteDisplayName?: string | null
  approvalState?: ApprovalState | null
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
    approval_state, created_at_ms, updated_at_ms`
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
  if (sessionType !== 'own' && remoteGrantId === null) {
    throw new Error('remote_grant_id_required_for_b2b_session')
  }
  db.prepare(
    `INSERT INTO chat_sessions (
       session_id, title, preview, session_type, remote_grant_id, remote_handle, remote_display_name,
       approval_state, created_at_ms, updated_at_ms
     ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    sessionType,
    remoteGrantId,
    options.remoteHandle?.trim() || null,
    options.remoteDisplayName?.trim() || null,
    options.approvalState ?? null,
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
        approval_state, created_at_ms, updated_at_ms
       FROM chat_sessions
       WHERE session_type = ? AND remote_grant_id = ?
       LIMIT 1`,
    )
    .get(sessionType, grantId) as ChatSessionRow | undefined
  if (!row) return null
  return rowToListItem(row, row.preview ?? undefined)
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
