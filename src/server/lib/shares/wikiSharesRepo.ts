import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'

export const WIKI_SHARE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type WikiShareTargetKind = 'dir' | 'file'

export type WikiShareRow = {
  id: string
  owner_id: string
  grantee_email: string
  grantee_id: string | null
  path_prefix: string
  /** `dir` = subtree under path_prefix (trailing `/`); `file` = single .md at path_prefix */
  target_kind: WikiShareTargetKind
  invite_token: string
  created_at_ms: number
  accepted_at_ms: number | null
  revoked_at_ms: number | null
}

function rowFromStmt(r: unknown): WikiShareRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.owner_id !== 'string' ||
    typeof o.grantee_email !== 'string' ||
    typeof o.path_prefix !== 'string' ||
    typeof o.invite_token !== 'string' ||
    typeof o.created_at_ms !== 'number'
  ) {
    return null
  }
  const tk = o.target_kind === 'file' ? 'file' : 'dir'
  return {
    id: o.id,
    owner_id: o.owner_id,
    grantee_email: o.grantee_email,
    grantee_id: typeof o.grantee_id === 'string' && o.grantee_id.length > 0 ? o.grantee_id : null,
    path_prefix: o.path_prefix,
    target_kind: tk,
    invite_token: o.invite_token,
    created_at_ms: o.created_at_ms,
    accepted_at_ms: typeof o.accepted_at_ms === 'number' ? o.accepted_at_ms : null,
    revoked_at_ms: typeof o.revoked_at_ms === 'number' ? o.revoked_at_ms : null,
  }
}

/** Vault-relative directory prefix: no leading slash, trailing slash required (except empty forbidden). */
export function normalizeWikiSharePathPrefix(raw: string): string {
  let p = raw.trim().replace(/^\/+/, '')
  if (!p) {
    throw new Error('path_prefix_required')
  }
  if (p.includes('..')) {
    throw new Error('path_prefix_invalid')
  }
  if (!p.endsWith('/')) {
    p = `${p}/`
  }
  return p
}

/** Vault-relative single markdown file: no leading slash, ends with `.md`, no `..`. */
export function normalizeWikiShareFilePath(raw: string): string {
  let p = raw.trim().replace(/^\/+/, '')
  if (!p || p.includes('..')) {
    throw new Error('path_invalid')
  }
  if (!p.endsWith('.md')) {
    throw new Error('path_must_be_md')
  }
  return p.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function newId(): string {
  return `wsh_${randomBytes(12).toString('hex')}`
}

function newToken(): string {
  return randomBytes(32).toString('hex')
}

export function createShare(params: {
  ownerId: string
  granteeEmail: string
  pathPrefix: string
  /** Default `dir` — share a folder subtree; `file` shares one `.md` page. */
  targetKind?: WikiShareTargetKind
  db?: Database.Database
}): WikiShareRow {
  const db = params.db ?? getBrainGlobalDb()
  const kind: WikiShareTargetKind = params.targetKind === 'file' ? 'file' : 'dir'
  const path_prefix =
    kind === 'file' ? normalizeWikiShareFilePath(params.pathPrefix) : normalizeWikiSharePathPrefix(params.pathPrefix)
  const grantee_email = normalizeEmail(params.granteeEmail)
  if (!grantee_email.includes('@')) {
    throw new Error('grantee_email_invalid')
  }
  const id = newId()
  const invite_token = newToken()
  const created_at_ms = Date.now()
  db.prepare(
    `INSERT INTO wiki_shares (
      id, owner_id, grantee_email, grantee_id, path_prefix, target_kind, invite_token, created_at_ms, accepted_at_ms, revoked_at_ms
    ) VALUES (@id, @owner_id, @grantee_email, NULL, @path_prefix, @target_kind, @invite_token, @created_at_ms, NULL, NULL)`,
  ).run({
    id,
    owner_id: params.ownerId,
    grantee_email,
    path_prefix,
    target_kind: kind,
    invite_token,
    created_at_ms,
  })
  return getShareById(id, db)!
}

export function getShareById(id: string, db?: Database.Database): WikiShareRow | null {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`SELECT * FROM wiki_shares WHERE id = ?`).get(id)
  return rowFromStmt(r)
}

/** Accepted, non-revoked share visible to this grantee (for virtual path resolution). */
export function getShareForGranteeById(shareId: string, granteeId: string, db?: Database.Database): WikiShareRow | null {
  const row = getShareById(shareId, db)
  if (!row) return null
  if (row.grantee_id !== granteeId) return null
  if (row.revoked_at_ms != null || row.accepted_at_ms == null) return null
  return row
}

export function getShareByToken(token: string, db?: Database.Database): WikiShareRow | null {
  const d = db ?? getBrainGlobalDb()
  const r = d.prepare(`SELECT * FROM wiki_shares WHERE invite_token = ?`).get(token.trim())
  return rowFromStmt(r)
}

export function listSharesForOwner(ownerId: string, db?: Database.Database): WikiShareRow[] {
  const d = db ?? getBrainGlobalDb()
  const rows = d
    .prepare(`SELECT * FROM wiki_shares WHERE owner_id = ? AND revoked_at_ms IS NULL ORDER BY created_at_ms DESC`)
    .all(ownerId)
  return rows.map((r) => rowFromStmt(r)).filter((x): x is WikiShareRow => x !== null)
}

export function listSharesForGrantee(granteeId: string, db?: Database.Database): WikiShareRow[] {
  const d = db ?? getBrainGlobalDb()
  const rows = d
    .prepare(
      `SELECT * FROM wiki_shares WHERE grantee_id = ? AND revoked_at_ms IS NULL AND accepted_at_ms IS NOT NULL ORDER BY created_at_ms DESC`,
    )
    .all(granteeId)
  return rows.map((r) => rowFromStmt(r)).filter((x): x is WikiShareRow => x !== null)
}

export function acceptShare(params: {
  token: string
  granteeId: string
  granteeEmail: string
  db?: Database.Database
}): WikiShareRow | null {
  const d = params.db ?? getBrainGlobalDb()
  const row = getShareByToken(params.token, d)
  if (!row) return null
  if (row.revoked_at_ms != null) return null
  const ge = normalizeEmail(params.granteeEmail)
  if (normalizeEmail(row.grantee_email) !== ge) {
    return null
  }
  const now = Date.now()
  if (now - row.created_at_ms > WIKI_SHARE_INVITE_TTL_MS) {
    return null
  }
  if (row.accepted_at_ms != null && row.grantee_id === params.granteeId) {
    return row
  }
  if (row.accepted_at_ms != null && row.grantee_id && row.grantee_id !== params.granteeId) {
    return null
  }
  d.prepare(
    `UPDATE wiki_shares SET grantee_id = @grantee_id, accepted_at_ms = @accepted_at_ms WHERE id = @id`,
  ).run({
    id: row.id,
    grantee_id: params.granteeId,
    accepted_at_ms: now,
  })
  return getShareById(row.id, d)
}

export function revokeShare(params: { shareId: string; ownerId: string; db?: Database.Database }): boolean {
  const d = params.db ?? getBrainGlobalDb()
  const row = getShareById(params.shareId, d)
  if (!row || row.owner_id !== params.ownerId) return false
  if (row.revoked_at_ms != null) return false
  const now = Date.now()
  d.prepare(`UPDATE wiki_shares SET revoked_at_ms = ? WHERE id = ?`).run(now, params.shareId)
  return true
}

/** True if `wikiRelPath` is allowed by this share row (directory subtree or exact file). */
export function granteeShareCoversWikiPath(row: WikiShareRow, wikiRelPath: string): boolean {
  const rel = wikiRelPath.trim().replace(/^\/+/, '')
  if (row.target_kind === 'file') {
    return rel === row.path_prefix.trim().replace(/^\/+/, '')
  }
  return wikiPathUnderSharePrefix(rel, row.path_prefix)
}

/** Vault-relative path is readable if it equals the directory root or is under `prefix/` (prefix ends with `/`). */
export function wikiPathUnderSharePrefix(wikiRelPath: string, pathPrefix: string): boolean {
  const rel = wikiRelPath.trim().replace(/^\/+/, '')
  const pre = pathPrefix.trim()
  if (!pre.endsWith('/')) return false
  const root = pre.slice(0, -1)
  if (rel === root) return true
  if (rel.startsWith(pre)) return true
  if (`${rel}/`.startsWith(pre)) return true
  return false
}

/**
 * True if grantee has an accepted, non-revoked share whose path_prefix covers wikiRelPath
 * (wikiRelPath normalized: no leading slash).
 */
export function granteeCanReadOwnerWikiPath(params: {
  granteeId: string
  ownerId: string
  wikiRelPath: string
  db?: Database.Database
}): boolean {
  const d = params.db ?? getBrainGlobalDb()
  const rows = d
    .prepare(
      `SELECT path_prefix, target_kind FROM wiki_shares
       WHERE owner_id = ? AND grantee_id = ? AND revoked_at_ms IS NULL AND accepted_at_ms IS NOT NULL`,
    )
    .all(params.ownerId, params.granteeId) as { path_prefix: string; target_kind: string | null }[]

  for (const r of rows) {
    const row: WikiShareRow = {
      id: '',
      owner_id: params.ownerId,
      grantee_email: '',
      grantee_id: params.granteeId,
      path_prefix: r.path_prefix,
      target_kind: r.target_kind === 'file' ? 'file' : 'dir',
      invite_token: '',
      created_at_ms: 0,
      accepted_at_ms: null,
      revoked_at_ms: null,
    }
    if (granteeShareCoversWikiPath(row, params.wikiRelPath)) return true
  }
  return false
}
