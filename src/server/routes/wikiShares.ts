import { Hono } from 'hono'
import { getTenantContext } from '@server/lib/tenant/tenantContext.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { readPrimaryRipmailImapEmail } from '@server/lib/platform/googleOAuth.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import {
  acceptShare,
  createShare,
  getShareByToken,
  listSharesForGrantee,
  listSharesForOwner,
  revokeShare,
  type WikiShareRow,
} from '@server/lib/shares/wikiSharesRepo.js'
import { sendWikiShareInviteEmail } from '@server/lib/shares/shareInviteEmail.js'

export type WikiShareApi = {
  id: string
  ownerId: string
  ownerHandle: string
  granteeEmail: string
  granteeId: string | null
  pathPrefix: string
  targetKind: 'dir' | 'file'
  createdAtMs: number
  acceptedAtMs: number | null
  revokedAtMs: number | null
}

async function toApiShare(row: WikiShareRow): Promise<WikiShareApi> {
  const meta = await readHandleMeta(tenantHomeDir(row.owner_id))
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: meta?.handle ?? row.owner_id,
    granteeEmail: row.grantee_email,
    granteeId: row.grantee_id,
    pathPrefix: row.path_prefix,
    targetKind: row.target_kind,
    createdAtMs: row.created_at_ms,
    acceptedAtMs: row.accepted_at_ms,
    revokedAtMs: row.revoked_at_ms,
  }
}

const wikiShares = new Hono()

/** POST /api/wiki-shares — owner creates invite */
wikiShares.post('/', async (c) => {
  const ctx = getTenantContext()
  let body: { pathPrefix?: unknown; granteeEmail?: unknown; targetKind?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const pathPrefix = typeof body.pathPrefix === 'string' ? body.pathPrefix : ''
  const granteeEmail = typeof body.granteeEmail === 'string' ? body.granteeEmail : ''
  const targetKind =
    body.targetKind === 'file' ? ('file' as const) : body.targetKind === 'dir' ? ('dir' as const) : undefined
  if (!pathPrefix.trim() || !granteeEmail.trim()) {
    return c.json({ error: 'pathPrefix_and_granteeEmail_required' }, 400)
  }
  try {
    const row = createShare({
      ownerId: ctx.tenantUserId,
      granteeEmail,
      pathPrefix,
      ...(targetKind ? { targetKind } : {}),
    })
    const origin = new URL(c.req.url).origin
    const inviteUrl = `${origin}/api/wiki-shares/accept/${encodeURIComponent(row.invite_token)}`
    const ownerHandle = ctx.workspaceHandle
    const { sent: emailSent } = await sendWikiShareInviteEmail({
      granteeEmail: row.grantee_email,
      inviteUrl,
      pathPrefix: row.path_prefix,
      ownerHandle,
    })
    const api = await toApiShare(row)
    return c.json({ ...api, inviteUrl, emailSent })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'create_failed'
    if (
      msg === 'path_prefix_required' ||
      msg === 'path_prefix_invalid' ||
      msg === 'grantee_email_invalid' ||
      msg === 'path_invalid' ||
      msg === 'path_must_be_md'
    ) {
      return c.json({ error: msg }, 400)
    }
    return c.json({ error: 'create_failed', message: msg }, 500)
  }
})

/** GET /api/wiki-shares — list owned + received */
wikiShares.get('/', async (c) => {
  const ctx = getTenantContext()
  const ownedRows = listSharesForOwner(ctx.tenantUserId)
  const receivedRows = listSharesForGrantee(ctx.tenantUserId)
  const owned = await Promise.all(ownedRows.map((r) => toApiShare(r)))
  const received = await Promise.all(receivedRows.map((r) => toApiShare(r)))
  return c.json({ owned, received })
})

/** DELETE /api/wiki-shares/:id — owner revokes */
wikiShares.delete('/:id', async (c) => {
  const ctx = getTenantContext()
  const id = c.req.param('id')
  const ok = revokeShare({ shareId: id, ownerId: ctx.tenantUserId })
  if (!ok) return c.json({ error: 'not_found_or_forbidden' }, 404)
  return c.json({ ok: true })
})

/** GET /api/wiki-shares/accept/:token — grantee accepts (vault + tenant required) */
wikiShares.get('/accept/:token', async (c) => {
  const ctx = getTenantContext()
  const token = c.req.param('token')
  const rowPre = getShareByToken(token)
  if (!rowPre || rowPre.revoked_at_ms != null) {
    return c.json({ error: 'invalid_or_revoked_token' }, 400)
  }
  const email =
    (await readPrimaryRipmailImapEmail(ripmailHomeForBrain()))?.trim().toLowerCase() ?? ''
  if (!email) {
    return c.json(
      {
        error: 'mailbox_email_unknown',
        message: 'Connect Gmail (ripmail) so your workspace email is known, then open the invite link again.',
      },
      400,
    )
  }
  const updated = acceptShare({
    token,
    granteeId: ctx.tenantUserId,
    granteeEmail: email,
  })
  if (!updated) {
    return c.json(
      { error: 'accept_failed', message: 'Token expired, wrong account, or email does not match the invite.' },
      400,
    )
  }
  const origin = new URL(c.req.url).origin
  const ownerMeta = await readHandleMeta(tenantHomeDir(updated.owner_id))
  const handleSeg = encodeURIComponent((ownerMeta?.handle ?? updated.owner_id).trim())
  const encRel = (rel: string) =>
    rel
      .split('/')
      .filter(Boolean)
      .map((p) => encodeURIComponent(p))
      .join('/')

  let loc: string
  if (updated.target_kind === 'file') {
    const rel = updated.path_prefix.trim()
    loc = `${origin}/wiki/@${handleSeg}/${encRel(rel)}`
  } else {
    const dirPath = updated.path_prefix.replace(/\/$/, '') || ''
    loc = dirPath
      ? `${origin}/wiki/@${handleSeg}/${encRel(dirPath)}/`
      : `${origin}/wiki/@${handleSeg}/`
  }
  return c.redirect(loc, 302)
})

export default wikiShares
