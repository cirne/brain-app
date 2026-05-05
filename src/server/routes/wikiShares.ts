import { Hono } from 'hono'
import { getTenantContext } from '@server/lib/tenant/tenantContext.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { isValidUserId, readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import {
  acceptShareById,
  createShare,
  getShareById,
  listPendingInvitesForGrantee,
  listSharesForGrantee,
  listSharesForOwner,
  revokeShare,
  type WikiShareRow,
} from '@server/lib/shares/wikiSharesRepo.js'
import {
  removeWikiShareProjectionForShare,
  syncWikiShareProjectionsForGrantee,
} from '@server/lib/shares/wikiShareProjection.js'
import {
  InvalidWorkspaceHandleError,
  parseWorkspaceHandle,
} from '@server/lib/tenant/workspaceHandle.js'
import {
  resolveConfirmedHandle,
  resolveUserIdByPrimaryEmail,
} from '@server/lib/tenant/workspaceHandleDirectory.js'

export type WikiShareApi = {
  id: string
  ownerId: string
  ownerHandle: string
  granteeEmail: string | null
  granteeId: string
  /** Present when the grantee workspace has a confirmed handle (owner UI). */
  granteeHandle?: string
  pathPrefix: string
  targetKind: 'dir' | 'file'
  createdAtMs: number
  acceptedAtMs: number | null
  revokedAtMs: number | null
}

async function toApiShare(row: WikiShareRow): Promise<WikiShareApi> {
  const ownerHome = tenantHomeDir(row.owner_id)
  const granteeHome = tenantHomeDir(row.grantee_id)
  const [meta, granteeMeta] = await Promise.all([readHandleMeta(ownerHome), readHandleMeta(granteeHome)])
  const granteeHandle =
    granteeMeta && typeof granteeMeta.confirmedAt === 'string' && granteeMeta.confirmedAt.length > 0
      ? granteeMeta.handle
      : undefined
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: meta?.handle ?? row.owner_id,
    granteeEmail: row.grantee_email,
    granteeId: row.grantee_id,
    ...(granteeHandle ? { granteeHandle } : {}),
    pathPrefix: row.path_prefix,
    targetKind: row.target_kind,
    createdAtMs: row.created_at_ms,
    acceptedAtMs: row.accepted_at_ms,
    revokedAtMs: row.revoked_at_ms,
  }
}

/** Wiki path URL after accept (`ownerDisplay` = confirmed handle or owner id). */
export function wikiUrlForAcceptedShare(origin: string, row: WikiShareRow, ownerDisplay: string): string {
  const handleSeg = encodeURIComponent(ownerDisplay.trim())
  const encRel = (rel: string) =>
    rel
      .split('/')
      .filter(Boolean)
      .map((p) => encodeURIComponent(p))
      .join('/')
  if (row.target_kind === 'file') {
    const rel = row.path_prefix.trim()
    return `${origin}/wikis/@${handleSeg}/${encRel(rel)}`
  }
  const dirPath = row.path_prefix.replace(/\/$/, '') || ''
  return dirPath
    ? `${origin}/wikis/@${handleSeg}/${encRel(dirPath)}/`
    : `${origin}/wikis/@${handleSeg}/`
}

const wikiShares = new Hono()

/** POST /api/wiki-shares — owner creates invite (grantee identified by tenant id) */
wikiShares.post('/', async (c) => {
  const ctx = getTenantContext()
  let body: {
    pathPrefix?: unknown
    granteeEmail?: unknown
    granteeHandle?: unknown
    granteeUserId?: unknown
    targetKind?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const pathPrefix = typeof body.pathPrefix === 'string' ? body.pathPrefix : ''
  const granteeEmailRaw = typeof body.granteeEmail === 'string' ? body.granteeEmail.trim() : ''
  const granteeHandleRaw = typeof body.granteeHandle === 'string' ? body.granteeHandle.trim() : ''
  const granteeUserIdRaw = typeof body.granteeUserId === 'string' ? body.granteeUserId.trim() : ''
  const targetKind =
    body.targetKind === 'file' ? ('file' as const) : body.targetKind === 'dir' ? ('dir' as const) : undefined
  if (!pathPrefix.trim()) {
    return c.json({ error: 'pathPrefix_required' }, 400)
  }
  const modes = [granteeEmailRaw, granteeHandleRaw, granteeUserIdRaw].filter((s) => s.length > 0)
  if (modes.length === 0) {
    return c.json({ error: 'grantee_required', message: 'Provide granteeUserId, handle, or email.' }, 400)
  }
  if (modes.length > 1) {
    return c.json(
      { error: 'grantee_conflict', message: 'Provide only one of granteeUserId, handle, or email.' },
      400,
    )
  }

  let granteeId: string
  let granteeEmail: string | null = null

  if (granteeUserIdRaw) {
    if (!isValidUserId(granteeUserIdRaw)) {
      return c.json({ error: 'invalid_grantee_user_id', message: 'Invalid grantee user id.' }, 400)
    }
    if (granteeUserIdRaw === ctx.tenantUserId) {
      return c.json({ error: 'grantee_is_owner', message: 'You cannot share with yourself.' }, 400)
    }
    const home = tenantHomeDir(granteeUserIdRaw)
    const meta = await readHandleMeta(home)
    if (!meta || typeof meta.confirmedAt !== 'string' || meta.confirmedAt.length === 0) {
      return c.json(
        { error: 'grantee_not_found', message: 'No confirmed workspace for that user id.' },
        400,
      )
    }
    granteeId = granteeUserIdRaw
  } else if (granteeHandleRaw) {
    let normalized: string
    try {
      normalized = parseWorkspaceHandle(granteeHandleRaw.replace(/^@/, ''))
    } catch (e) {
      const msg = e instanceof InvalidWorkspaceHandleError ? e.message : 'Invalid handle.'
      return c.json({ error: 'invalid_handle', message: msg }, 400)
    }
    const dirEntry = await resolveConfirmedHandle({
      handle: normalized,
      excludeUserId: ctx.tenantUserId,
    })
    if (!dirEntry) {
      return c.json({ error: 'handle_not_found', message: `No Braintunnel user @${normalized}.` }, 400)
    }
    granteeId = dirEntry.userId
    granteeEmail = dirEntry.primaryEmail
  } else {
    const resolved = await resolveUserIdByPrimaryEmail({
      email: granteeEmailRaw,
      excludeUserId: ctx.tenantUserId,
    })
    if (!resolved) {
      return c.json(
        {
          error: 'grantee_not_found',
          message: 'No Braintunnel user has that mailbox as their primary email.',
        },
        400,
      )
    }
    granteeId = resolved
    granteeEmail = granteeEmailRaw.toLowerCase()
  }

  try {
    const row = createShare({
      ownerId: ctx.tenantUserId,
      granteeId,
      granteeEmail,
      pathPrefix,
      ...(targetKind ? { targetKind } : {}),
    })
    const api = await toApiShare(row)
    return c.json(api)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'create_failed'
    if (
      msg === 'path_prefix_required' ||
      msg === 'path_prefix_invalid' ||
      msg === 'grantee_email_invalid' ||
      msg === 'path_invalid' ||
      msg === 'path_must_be_md' ||
      msg === 'grantee_id_required' ||
      msg === 'grantee_is_owner'
    ) {
      return c.json({ error: msg }, 400)
    }
    return c.json({ error: 'create_failed', message: msg }, 500)
  }
})

/** GET /api/wiki-shares — list owned + received + pending (for signed-in tenant id) */
wikiShares.get('/', async (c) => {
  const ctx = getTenantContext()
  const ownedRows = listSharesForOwner(ctx.tenantUserId)
  const receivedRows = listSharesForGrantee(ctx.tenantUserId)
  const owned = await Promise.all(ownedRows.map((r) => toApiShare(r)))
  const received = await Promise.all(receivedRows.map((r) => toApiShare(r)))
  const pendingRows = listPendingInvitesForGrantee(ctx.tenantUserId)
  const pendingReceived = await Promise.all(pendingRows.map((r) => toApiShare(r)))
  return c.json({ owned, received, pendingReceived })
})

/** POST /api/wiki-shares/:id/accept — grantee accepts in-app (signed-in tenant must match invited grantee_id) */
wikiShares.post('/:id/accept', async (c) => {
  const ctx = getTenantContext()
  const shareId = c.req.param('id')
  const updated = acceptShareById({
    shareId,
    granteeId: ctx.tenantUserId,
  })
  if (!updated) {
    return c.json(
      {
        error: 'accept_failed',
        message: 'Invite expired, revoked, or this account is not the invited workspace.',
      },
      400,
    )
  }
  void syncWikiShareProjectionsForGrantee(ctx.tenantUserId).catch(() => {})
  const origin = new URL(c.req.url).origin
  const ownerMeta = await readHandleMeta(tenantHomeDir(updated.owner_id))
  const ownerDisplay = (ownerMeta?.handle ?? updated.owner_id).trim()
  const wikiUrl = wikiUrlForAcceptedShare(origin, updated, ownerDisplay)
  return c.json({
    ok: true as const,
    ownerId: updated.owner_id,
    ownerHandle: ownerDisplay,
    pathPrefix: updated.path_prefix,
    targetKind: updated.target_kind,
    wikiUrl,
  })
})

/** DELETE /api/wiki-shares/:id — owner revokes */
wikiShares.delete('/:id', async (c) => {
  const ctx = getTenantContext()
  const id = c.req.param('id')
  const row = getShareById(id)
  if (!row || row.owner_id !== ctx.tenantUserId) {
    return c.json({ error: 'not_found_or_forbidden' }, 404)
  }
  const projectionOk = await removeWikiShareProjectionForShare({
    granteeTenantUserId: row.grantee_id,
    share: row,
  })
  if (!projectionOk) {
    return c.json({ error: 'revoke_projection_failed', message: 'Could not remove grantee filesystem link.' }, 500)
  }
  const ok = revokeShare({ shareId: id, ownerId: ctx.tenantUserId })
  if (!ok) return c.json({ error: 'not_found_or_forbidden' }, 404)
  return c.json({ ok: true })
})

export default wikiShares
