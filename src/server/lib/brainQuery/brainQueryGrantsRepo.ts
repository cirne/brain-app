import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'
import { DEFAULT_BRAIN_QUERY_PRIVACY_POLICY } from './defaultPrivacyPolicy.js'

export type BrainQueryGrantRow = {
  id: string
  owner_id: string
  asker_id: string
  privacy_policy: string
  created_at_ms: number
  updated_at_ms: number
  revoked_at_ms: number | null
}

function rowFromStmt(r: unknown): BrainQueryGrantRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.owner_id !== 'string' ||
    typeof o.asker_id !== 'string' ||
    typeof o.privacy_policy !== 'string' ||
    typeof o.created_at_ms !== 'number' ||
    typeof o.updated_at_ms !== 'number'
  ) {
    return null
  }
  const rev = o.revoked_at_ms
  return {
    id: o.id,
    owner_id: o.owner_id,
    asker_id: o.asker_id,
    privacy_policy: o.privacy_policy,
    created_at_ms: o.created_at_ms,
    updated_at_ms: o.updated_at_ms,
    revoked_at_ms: typeof rev === 'number' ? rev : null,
  }
}

function newId(): string {
  return `bqg_${randomBytes(12).toString('hex')}`
}

export function createBrainQueryGrant(params: {
  ownerId: string
  askerId: string
  privacyPolicy?: string
  db?: Database.Database
}): BrainQueryGrantRow {
  const db = params.db ?? getBrainGlobalDb()
  const owner_id = params.ownerId.trim()
  const asker_id = params.askerId.trim()
  if (!owner_id || !asker_id) {
    throw new Error('owner_and_asker_required')
  }
  if (owner_id === asker_id) {
    throw new Error('asker_is_owner')
  }
  const privacy_policy =
    typeof params.privacyPolicy === 'string' && params.privacyPolicy.trim().length > 0
      ? params.privacyPolicy.trim()
      : DEFAULT_BRAIN_QUERY_PRIVACY_POLICY
  const id = newId()
  const now = Date.now()
  db.prepare(
    `INSERT INTO brain_query_grants (
      id, owner_id, asker_id, privacy_policy, created_at_ms, updated_at_ms, revoked_at_ms
    ) VALUES (@id, @owner_id, @asker_id, @privacy_policy, @created_at_ms, @updated_at_ms, NULL)`,
  ).run({
    id,
    owner_id,
    asker_id,
    privacy_policy,
    created_at_ms: now,
    updated_at_ms: now,
  })
  return getBrainQueryGrantById(id, db)!
}

export function getBrainQueryGrantById(id: string, db?: Database.Database): BrainQueryGrantRow | null {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`SELECT * FROM brain_query_grants WHERE id = ?`).get(id)
  return rowFromStmt(r)
}

/** Active (non-revoked) grant where `owner` allows `asker` to query. */
export function getActiveBrainQueryGrant(params: {
  ownerId: string
  askerId: string
  db?: Database.Database
}): BrainQueryGrantRow | null {
  const d = params.db ?? getBrainGlobalDb()
  const r = d
    .prepare(
      `SELECT * FROM brain_query_grants
       WHERE owner_id = ? AND asker_id = ? AND revoked_at_ms IS NULL
       LIMIT 1`,
    )
    .get(params.ownerId.trim(), params.askerId.trim())
  return rowFromStmt(r)
}

export function listBrainQueryGrantsForOwner(ownerId: string, db?: Database.Database): BrainQueryGrantRow[] {
  const d = db ?? getBrainGlobalDb()
  const rows = d
    .prepare(
      `SELECT * FROM brain_query_grants WHERE owner_id = ? AND revoked_at_ms IS NULL ORDER BY created_at_ms DESC`,
    )
    .all(ownerId)
  return rows.map((r) => rowFromStmt(r)).filter((x): x is BrainQueryGrantRow => x !== null)
}

export function listBrainQueryGrantsForAsker(askerId: string, db?: Database.Database): BrainQueryGrantRow[] {
  const d = db ?? getBrainGlobalDb()
  const rows = d
    .prepare(
      `SELECT * FROM brain_query_grants WHERE asker_id = ? AND revoked_at_ms IS NULL ORDER BY created_at_ms DESC`,
    )
    .all(askerId)
  return rows.map((r) => rowFromStmt(r)).filter((x): x is BrainQueryGrantRow => x !== null)
}

export function updateBrainQueryGrantPrivacyPolicy(params: {
  grantId: string
  ownerId: string
  privacyPolicy: string
  db?: Database.Database
}): BrainQueryGrantRow | null {
  const d = params.db ?? getBrainGlobalDb()
  const row = getBrainQueryGrantById(params.grantId, d)
  if (!row || row.owner_id !== params.ownerId || row.revoked_at_ms != null) return null
  const text = params.privacyPolicy.trim()
  if (!text) return null
  const now = Date.now()
  d.prepare(
    `UPDATE brain_query_grants SET privacy_policy = ?, updated_at_ms = ? WHERE id = ? AND owner_id = ?`,
  ).run(text, now, params.grantId, params.ownerId)
  return getBrainQueryGrantById(params.grantId, d)
}

/** Revoke a grant whose asker matches (incoming access you were given — renounce without owner action). */
export function revokeBrainQueryGrantAsAsker(params: {
  grantId: string
  askerId: string
  db?: Database.Database
}): boolean {
  const d = params.db ?? getBrainGlobalDb()
  const row = getBrainQueryGrantById(params.grantId, d)
  if (!row || row.asker_id !== params.askerId || row.revoked_at_ms != null) return false
  const now = Date.now()
  d.prepare(`UPDATE brain_query_grants SET revoked_at_ms = ?, updated_at_ms = ? WHERE id = ?`).run(
    now,
    now,
    params.grantId,
  )
  return true
}

export function revokeBrainQueryGrant(params: {
  grantId: string
  ownerId: string
  db?: Database.Database
}): boolean {
  const d = params.db ?? getBrainGlobalDb()
  const row = getBrainQueryGrantById(params.grantId, d)
  if (!row || row.owner_id !== params.ownerId || row.revoked_at_ms != null) return false
  const now = Date.now()
  d.prepare(`UPDATE brain_query_grants SET revoked_at_ms = ?, updated_at_ms = ? WHERE id = ?`).run(
    now,
    now,
    params.grantId,
  )
  return true
}

/**
 * Revoke the owner's grant row and, when one exists, the reciprocal peer→owner grant.
 * Keeps Brain-to-Brain pairing unambiguous: removing a collaborator drops both directions.
 */
export function revokeBrainQueryGrantAndReciprocal(params: {
  grantId: string
  ownerId: string
  db?: Database.Database
}): { revoked: boolean; reciprocalRevoked: boolean } {
  const d = params.db ?? getBrainGlobalDb()
  return d.transaction(() => {
    const row = getBrainQueryGrantById(params.grantId, d)
    if (!row || row.owner_id !== params.ownerId || row.revoked_at_ms != null) {
      return { revoked: false, reciprocalRevoked: false }
    }
    const peerId = row.asker_id
    if (!revokeBrainQueryGrant({ grantId: params.grantId, ownerId: params.ownerId, db: d })) {
      return { revoked: false, reciprocalRevoked: false }
    }
    const reciprocal = getActiveBrainQueryGrant({ ownerId: peerId, askerId: params.ownerId, db: d })
    if (!reciprocal) {
      return { revoked: true, reciprocalRevoked: false }
    }
    const reciprocalRevoked = revokeBrainQueryGrant({
      grantId: reciprocal.id,
      ownerId: peerId,
      db: d,
    })
    return { revoked: true, reciprocalRevoked }
  })()
}

/** Dev tenant reset: remove grants where this user is owner or asker. */
export function deleteBrainQueryGrantsForTenant(tenantUserId: string, db?: Database.Database): number {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`DELETE FROM brain_query_grants WHERE owner_id = ? OR asker_id = ?`).run(tenantUserId, tenantUserId)
  return typeof r.changes === 'number' ? r.changes : 0
}

/** @deprecated Prefer {@link deleteBrainQueryGrantsForTenant} for full cleanup. */
export function deleteBrainQueryGrantsForOwner(ownerId: string, db?: Database.Database): number {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`DELETE FROM brain_query_grants WHERE owner_id = ?`).run(ownerId)
  return typeof r.changes === 'number' ? r.changes : 0
}
