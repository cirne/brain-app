import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'

export type BrainQueryCustomPolicyRow = {
  id: string
  owner_id: string
  title: string
  body: string
  created_at_ms: number
  updated_at_ms: number
}

function rowFromStmt(r: unknown): BrainQueryCustomPolicyRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.owner_id !== 'string' ||
    typeof o.title !== 'string' ||
    typeof o.body !== 'string' ||
    typeof o.created_at_ms !== 'number' ||
    typeof o.updated_at_ms !== 'number'
  ) {
    return null
  }
  return {
    id: o.id,
    owner_id: o.owner_id,
    title: o.title,
    body: o.body,
    created_at_ms: o.created_at_ms,
    updated_at_ms: o.updated_at_ms,
  }
}

function newId(): string {
  return `bqc_${randomBytes(12).toString('hex')}`
}

export function getBrainQueryCustomPolicyById(id: string, db?: Database.Database): BrainQueryCustomPolicyRow | null {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`SELECT * FROM brain_query_custom_policies WHERE id = ?`).get(id.trim())
  return rowFromStmt(r)
}

export function listBrainQueryCustomPoliciesForOwner(ownerId: string, db?: Database.Database): BrainQueryCustomPolicyRow[] {
  const d = db ?? getBrainGlobalDb()
  const rows = d
    .prepare(
      `SELECT * FROM brain_query_custom_policies WHERE owner_id = ? ORDER BY updated_at_ms DESC`,
    )
    .all(ownerId.trim())
  return rows.map((r) => rowFromStmt(r)).filter((x): x is BrainQueryCustomPolicyRow => x !== null)
}

export function createBrainQueryCustomPolicy(params: {
  ownerId: string
  title: string
  body: string
  db?: Database.Database
}): BrainQueryCustomPolicyRow {
  const d = params.db ?? getBrainGlobalDb()
  const owner_id = params.ownerId.trim()
  const title = params.title.trim()
  const body = params.body.trim()
  if (!owner_id) throw new Error('owner_required')
  if (!title) throw new Error('title_required')
  if (!body) throw new Error('body_required')
  const id = newId()
  const now = Date.now()
  d.prepare(
    `INSERT INTO brain_query_custom_policies (id, owner_id, title, body, created_at_ms, updated_at_ms)
     VALUES (@id, @owner_id, @title, @body, @created_at_ms, @updated_at_ms)`,
  ).run({ id, owner_id, title, body, created_at_ms: now, updated_at_ms: now })
  return getBrainQueryCustomPolicyById(id, d)!
}

export function updateBrainQueryCustomPolicy(params: {
  policyId: string
  ownerId: string
  title?: string
  body?: string
  db?: Database.Database
}): BrainQueryCustomPolicyRow | null {
  const d = params.db ?? getBrainGlobalDb()
  const row = getBrainQueryCustomPolicyById(params.policyId, d)
  if (!row || row.owner_id !== params.ownerId.trim()) return null
  const title = params.title !== undefined ? params.title.trim() : row.title
  const body = params.body !== undefined ? params.body.trim() : row.body
  if (!title) return null
  if (!body) return null
  const now = Date.now()
  d.prepare(
    `UPDATE brain_query_custom_policies SET title = ?, body = ?, updated_at_ms = ? WHERE id = ? AND owner_id = ?`,
  ).run(title, body, now, params.policyId, params.ownerId.trim())
  return getBrainQueryCustomPolicyById(params.policyId, d)
}

export function countGrantsReferencingCustomPolicy(policyId: string, db?: Database.Database): number {
  const d = db ?? getBrainGlobalDb()
  const row = d
    .prepare(`SELECT COUNT(*) AS c FROM brain_query_grants WHERE custom_policy_id = ? AND revoked_at_ms IS NULL`)
    .get(policyId.trim()) as { c: number } | undefined
  return row?.c ?? 0
}

export function deleteBrainQueryCustomPolicy(params: {
  policyId: string
  ownerId: string
  db?: Database.Database
}): { ok: true } | { ok: false; reason: 'not_found' | 'in_use' } {
  const d = params.db ?? getBrainGlobalDb()
  const row = getBrainQueryCustomPolicyById(params.policyId, d)
  if (!row || row.owner_id !== params.ownerId.trim()) {
    return { ok: false, reason: 'not_found' }
  }
  if (countGrantsReferencingCustomPolicy(params.policyId, d) > 0) {
    return { ok: false, reason: 'in_use' }
  }
  d.prepare(`DELETE FROM brain_query_custom_policies WHERE id = ? AND owner_id = ?`).run(
    params.policyId,
    params.ownerId.trim(),
  )
  return { ok: true }
}

/** Remove all custom policies for an owner (call after deleting grants that reference them). */
export function deleteBrainQueryCustomPoliciesForOwner(ownerId: string, db?: Database.Database): number {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`DELETE FROM brain_query_custom_policies WHERE owner_id = ?`).run(ownerId.trim())
  return typeof r.changes === 'number' ? r.changes : 0
}
