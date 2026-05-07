import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'

export type BrainQueryLogStatus = 'ok' | 'denied_no_grant' | 'filter_blocked' | 'error'

export type BrainQueryLogRow = {
  id: string
  owner_id: string
  asker_id: string
  question: string
  draft_answer: string | null
  final_answer: string | null
  filter_notes: string | null
  status: BrainQueryLogStatus
  created_at_ms: number
  duration_ms: number | null
}

function parseStatus(s: string): BrainQueryLogStatus {
  if (s === 'ok' || s === 'denied_no_grant' || s === 'filter_blocked' || s === 'error') return s
  return 'error'
}

function rowFromStmt(r: unknown): BrainQueryLogRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.owner_id !== 'string' ||
    typeof o.asker_id !== 'string' ||
    typeof o.question !== 'string' ||
    typeof o.status !== 'string' ||
    typeof o.created_at_ms !== 'number'
  ) {
    return null
  }
  const dur = o.duration_ms
  const draft = o.draft_answer
  const finalA = o.final_answer
  const notes = o.filter_notes
  return {
    id: o.id,
    owner_id: o.owner_id,
    asker_id: o.asker_id,
    question: o.question,
    draft_answer: typeof draft === 'string' ? draft : null,
    final_answer: typeof finalA === 'string' ? finalA : null,
    filter_notes: typeof notes === 'string' ? notes : null,
    status: parseStatus(o.status),
    created_at_ms: o.created_at_ms,
    duration_ms: typeof dur === 'number' ? dur : null,
  }
}

function newLogId(): string {
  return `bql_${randomBytes(12).toString('hex')}`
}

export function insertBrainQueryLog(params: {
  ownerId: string
  askerId: string
  question: string
  draftAnswer: string | null
  finalAnswer: string | null
  filterNotes: string | null
  status: BrainQueryLogStatus
  durationMs: number | null
  db?: Database.Database
}): BrainQueryLogRow {
  const db = params.db ?? getBrainGlobalDb()
  const id = newLogId()
  const now = Date.now()
  db.prepare(
    `INSERT INTO brain_query_log (
      id, owner_id, asker_id, question, draft_answer, final_answer, filter_notes, status, created_at_ms, duration_ms
    ) VALUES (@id, @owner_id, @asker_id, @question, @draft_answer, @final_answer, @filter_notes, @status, @created_at_ms, @duration_ms)`,
  ).run({
    id,
    owner_id: params.ownerId,
    asker_id: params.askerId,
    question: params.question,
    draft_answer: params.draftAnswer,
    final_answer: params.finalAnswer,
    filter_notes: params.filterNotes,
    status: params.status,
    created_at_ms: now,
    duration_ms: params.durationMs,
  })
  return getBrainQueryLogById(id, db)!
}

export function getBrainQueryLogById(id: string, db?: Database.Database): BrainQueryLogRow | null {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`SELECT * FROM brain_query_log WHERE id = ?`).get(id)
  return rowFromStmt(r)
}

/** Owner view: inbound queries to this tenant's brain. */
export function listBrainQueryLogForOwner(ownerId: string, limit: number, db?: Database.Database): BrainQueryLogRow[] {
  const d = db ?? getBrainGlobalDb()
  const cap = Math.min(Math.max(limit, 1), 200)
  const rows = d
    .prepare(`SELECT * FROM brain_query_log WHERE owner_id = ? ORDER BY created_at_ms DESC LIMIT ?`)
    .all(ownerId, cap)
  return rows.map((r) => rowFromStmt(r)).filter((x): x is BrainQueryLogRow => x !== null)
}

/** Asker view: questions this tenant sent to others. */
export function listBrainQueryLogForAsker(askerId: string, limit: number, db?: Database.Database): BrainQueryLogRow[] {
  const d = db ?? getBrainGlobalDb()
  const cap = Math.min(Math.max(limit, 1), 200)
  const rows = d
    .prepare(`SELECT * FROM brain_query_log WHERE asker_id = ? ORDER BY created_at_ms DESC LIMIT ?`)
    .all(askerId, cap)
  return rows.map((r) => rowFromStmt(r)).filter((x): x is BrainQueryLogRow => x !== null)
}

export function deleteBrainQueryLogForTenant(tenantUserId: string, db?: Database.Database): number {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`DELETE FROM brain_query_log WHERE owner_id = ? OR asker_id = ?`).run(tenantUserId, tenantUserId)
  return typeof r.changes === 'number' ? r.changes : 0
}
