import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'
import { getBrainQueryCustomPolicyById } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import type { BrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'
import { isBrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'

/** Owner-side tunnel setting: auto-reply, review each reply, or ignore inbound from this asker. */
export type BrainQueryGrantReplyMode = 'auto' | 'review' | 'ignore'

/** @deprecated Use {@link BrainQueryGrantReplyMode}. */
export type BrainQueryGrantPolicy = BrainQueryGrantReplyMode

export type BrainQueryGrantRow = {
  id: string
  owner_id: string
  asker_id: string
  /** Mutually exclusive with `custom_policy_id`; built-in key resolved from `.hbs`. */
  preset_policy_key: string | null
  /** Mutually exclusive with `preset_policy_key`; FK to `brain_query_custom_policies`. */
  custom_policy_id: string | null
  reply_mode: BrainQueryGrantReplyMode
  created_at_ms: number
  updated_at_ms: number
  revoked_at_ms: number | null
}

function parseReplyMode(raw: unknown): BrainQueryGrantReplyMode {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'auto' || s === 'review' || s === 'ignore') return s
  return 'review'
}

/** Exactly one of preset or custom must be set (application invariant). */
export function assertGrantPrivacyXor(row: Pick<BrainQueryGrantRow, 'preset_policy_key' | 'custom_policy_id'>): void {
  const hasP = row.preset_policy_key != null && row.preset_policy_key.trim().length > 0
  const hasC = row.custom_policy_id != null && row.custom_policy_id.trim().length > 0
  if (hasP === hasC) {
    throw new Error('grant_privacy_xor_invalid')
  }
}

function rowFromStmt(r: unknown): BrainQueryGrantRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const pk = o.preset_policy_key
  const cid = o.custom_policy_id
  const preset_policy_key =
    pk != null && typeof pk === 'string' && pk.trim().length > 0 ? pk.trim() : null
  const custom_policy_id =
    cid != null && typeof cid === 'string' && cid.trim().length > 0 ? cid.trim() : null
  if (
    typeof o.id !== 'string' ||
    typeof o.owner_id !== 'string' ||
    typeof o.asker_id !== 'string' ||
    typeof o.created_at_ms !== 'number' ||
    typeof o.updated_at_ms !== 'number'
  ) {
    return null
  }
  if ((preset_policy_key == null) === (custom_policy_id == null)) {
    return null
  }
  const rev = o.revoked_at_ms
  return {
    id: o.id,
    owner_id: o.owner_id,
    asker_id: o.asker_id,
    preset_policy_key,
    custom_policy_id,
    reply_mode: parseReplyMode(o.reply_mode),
    created_at_ms: o.created_at_ms,
    updated_at_ms: o.updated_at_ms,
    revoked_at_ms: typeof rev === 'number' ? rev : null,
  }
}

function newId(): string {
  return `bqg_${randomBytes(12).toString('hex')}`
}

function resolvePrivacyColumns(params: {
  ownerId: string
  presetPolicyKey?: BrainQueryBuiltinPolicyId
  customPolicyId?: string
  db: Database.Database
}): { preset_policy_key: string | null; custom_policy_id: string | null } {
  const hasPreset = params.presetPolicyKey != null && isBrainQueryBuiltinPolicyId(params.presetPolicyKey)
  const cid = params.customPolicyId?.trim() ?? ''
  const hasCustom = cid.length > 0
  if (hasPreset === hasCustom) {
    throw new Error('grant_privacy_xor_invalid')
  }
  if (hasPreset) {
    return { preset_policy_key: params.presetPolicyKey!, custom_policy_id: null }
  }
  const policy = getBrainQueryCustomPolicyById(cid, params.db)
  if (!policy || policy.owner_id !== params.ownerId.trim()) {
    throw new Error('custom_policy_not_found')
  }
  return { preset_policy_key: null, custom_policy_id: cid }
}

export function createBrainQueryGrant(params: {
  ownerId: string
  askerId: string
  presetPolicyKey?: BrainQueryBuiltinPolicyId
  customPolicyId?: string
  replyMode?: BrainQueryGrantReplyMode
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
  const { preset_policy_key, custom_policy_id } = resolvePrivacyColumns({
    ownerId: owner_id,
    presetPolicyKey: params.presetPolicyKey,
    customPolicyId: params.customPolicyId,
    db,
  })
  const reply_mode: BrainQueryGrantReplyMode = params.replyMode ?? 'review'
  const id = newId()
  const now = Date.now()
  /** One row per (owner, asker); remove prior row so re-invite works after revoke or legacy soft-revoke. */
  db.prepare(`DELETE FROM brain_query_grants WHERE owner_id = ? AND asker_id = ?`).run(owner_id, asker_id)
  db.prepare(
    `INSERT INTO brain_query_grants (
      id, owner_id, asker_id, preset_policy_key, custom_policy_id, reply_mode, created_at_ms, updated_at_ms, revoked_at_ms
    ) VALUES (@id, @owner_id, @asker_id, @preset_policy_key, @custom_policy_id, @reply_mode, @created_at_ms, @updated_at_ms, NULL)`,
  ).run({
    id,
    owner_id,
    asker_id,
    preset_policy_key,
    custom_policy_id,
    reply_mode,
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

export function updateBrainQueryGrantPrivacyInstructions(params: {
  grantId: string
  ownerId: string
  presetPolicyKey?: BrainQueryBuiltinPolicyId
  customPolicyId?: string
  db?: Database.Database
}): BrainQueryGrantRow | null {
  const d = params.db ?? getBrainGlobalDb()
  const row = getBrainQueryGrantById(params.grantId, d)
  if (!row || row.owner_id !== params.ownerId) return null
  const { preset_policy_key, custom_policy_id } = resolvePrivacyColumns({
    ownerId: params.ownerId,
    presetPolicyKey: params.presetPolicyKey,
    customPolicyId: params.customPolicyId,
    db: d,
  })
  const now = Date.now()
  d.prepare(
    `UPDATE brain_query_grants SET preset_policy_key = ?, custom_policy_id = ?, updated_at_ms = ? WHERE id = ? AND owner_id = ?`,
  ).run(preset_policy_key, custom_policy_id, now, params.grantId, params.ownerId)
  return getBrainQueryGrantById(params.grantId, d)
}

export function setBrainQueryGrantReplyMode(params: {
  grantId: string
  ownerId: string
  replyMode: BrainQueryGrantReplyMode
  db?: Database.Database
}): BrainQueryGrantRow | null {
  const d = params.db ?? getBrainGlobalDb()
  const row = getBrainQueryGrantById(params.grantId, d)
  if (!row || row.owner_id !== params.ownerId.trim()) return null
  const now = Date.now()
  d.prepare(`UPDATE brain_query_grants SET reply_mode = ?, updated_at_ms = ? WHERE id = ? AND owner_id = ?`).run(
    params.replyMode,
    now,
    params.grantId,
    params.ownerId.trim(),
  )
  return getBrainQueryGrantById(params.grantId, d)
}

/** @deprecated Use {@link setBrainQueryGrantReplyMode}. */
export function setBrainQueryGrantPolicy(params: {
  grantId: string
  ownerId: string
  policy: BrainQueryGrantReplyMode
  db?: Database.Database
}): BrainQueryGrantRow | null {
  return setBrainQueryGrantReplyMode({
    grantId: params.grantId,
    ownerId: params.ownerId,
    replyMode: params.policy,
    db: params.db,
  })
}

/** @deprecated Use {@link setBrainQueryGrantReplyMode}. */
export function setBrainQueryGrantAutoSend(params: {
  grantId: string
  ownerId: string
  autoSend: boolean
  db?: Database.Database
}): BrainQueryGrantRow | null {
  return setBrainQueryGrantReplyMode({
    grantId: params.grantId,
    ownerId: params.ownerId,
    replyMode: params.autoSend ? 'auto' : 'review',
    db: params.db,
  })
}

/** Whether outbound replies are sent to the asker without owner review (grant opt-in). */
export function grantRowAutoSendEnabled(row: BrainQueryGrantRow): boolean {
  return row.reply_mode === 'auto'
}

export function grantRowIgnoresInbound(row: BrainQueryGrantRow): boolean {
  return row.reply_mode === 'ignore'
}

/** Remove grant row (owner revoking outbound access). */
export function revokeBrainQueryGrant(params: {
  grantId: string
  ownerId: string
  db?: Database.Database
}): boolean {
  const d = params.db ?? getBrainGlobalDb()
  const r = d.prepare(`DELETE FROM brain_query_grants WHERE id = ? AND owner_id = ?`).run(params.grantId, params.ownerId)
  return (r.changes ?? 0) > 0
}

/** Remove inbound grant row (asker renouncing access someone granted them). */
export function revokeBrainQueryGrantAsAsker(params: {
  grantId: string
  askerId: string
  db?: Database.Database
}): boolean {
  const d = params.db ?? getBrainGlobalDb()
  const r = d.prepare(`DELETE FROM brain_query_grants WHERE id = ? AND asker_id = ?`).run(params.grantId, params.askerId)
  return (r.changes ?? 0) > 0
}

/**
 * Remove the owner's grant row and, when one exists, the reciprocal peer→owner grant.
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
    if (!row || row.owner_id !== params.ownerId) {
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
