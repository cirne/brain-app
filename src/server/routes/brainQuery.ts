import { Hono } from 'hono'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { createNotificationForTenant } from '@server/lib/notifications/createNotificationForTenant.js'
import { getTenantContext } from '@server/lib/tenant/tenantContext.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { isValidUserId, readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import {
  InvalidWorkspaceHandleError,
  parseWorkspaceHandle,
} from '@server/lib/tenant/workspaceHandle.js'
import {
  resolveConfirmedHandle,
  resolveUserIdByPrimaryEmail,
} from '@server/lib/tenant/workspaceHandleDirectory.js'
import {
  createBrainQueryGrant,
  getBrainQueryGrantById,
  listBrainQueryGrantsForAsker,
  listBrainQueryGrantsForOwner,
  revokeBrainQueryGrantAndReciprocal,
  revokeBrainQueryGrantAsAsker,
  updateBrainQueryGrantPrivacyPolicy,
  type BrainQueryGrantRow,
} from '@server/lib/brainQuery/brainQueryGrantsRepo.js'

const GRANT_POLICY_PREVIEW_MAX = 200

function grantPrivacyPolicyPreview(policy: string): string {
  const t = policy.trim()
  if (t.length <= GRANT_POLICY_PREVIEW_MAX) return t
  return `${t.slice(0, GRANT_POLICY_PREVIEW_MAX - 1)}…`
}

export type BrainQueryGrantApi = {
  id: string
  ownerId: string
  ownerHandle: string
  askerId: string
  askerHandle?: string
  privacyPolicy: string
  createdAtMs: number
  updatedAtMs: number
}

async function toApiGrant(row: BrainQueryGrantRow): Promise<BrainQueryGrantApi> {
  const ownerHome = tenantHomeDir(row.owner_id)
  const askerHome = tenantHomeDir(row.asker_id)
  const [ownerMeta, askerMeta] = await Promise.all([readHandleMeta(ownerHome), readHandleMeta(askerHome)])
  const askerHandle =
    askerMeta && typeof askerMeta.confirmedAt === 'string' && askerMeta.confirmedAt.length > 0
      ? askerMeta.handle
      : undefined
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: ownerMeta?.handle ?? row.owner_id,
    askerId: row.asker_id,
    ...(askerHandle ? { askerHandle } : {}),
    privacyPolicy: row.privacy_policy,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }
}

/** Resolve collaborator id (must have confirmed handle), same rules as wiki share grantee. */
async function resolveAskerUserId(params: {
  ctxTenantId: string
  askerUserIdRaw: string
  askerHandleRaw: string
  askerEmailRaw: string
}): Promise<{ askerId: string } | { error: string; message: string; status: 400 | 404 }> {
  const { ctxTenantId, askerUserIdRaw, askerHandleRaw, askerEmailRaw } = params
  if (askerUserIdRaw) {
    if (!isValidUserId(askerUserIdRaw)) {
      return { error: 'invalid_asker_user_id', message: 'Invalid asker user id.', status: 400 }
    }
    if (askerUserIdRaw === ctxTenantId) {
      return { error: 'asker_is_owner', message: 'You cannot grant query access to yourself.', status: 400 }
    }
    const home = tenantHomeDir(askerUserIdRaw)
    const meta = await readHandleMeta(home)
    if (!meta || typeof meta.confirmedAt !== 'string' || meta.confirmedAt.length === 0) {
      return {
        error: 'asker_not_found',
        message: 'No confirmed workspace for that user id.',
        status: 400,
      }
    }
    return { askerId: askerUserIdRaw }
  }
  if (askerHandleRaw) {
    let normalized: string
    try {
      normalized = parseWorkspaceHandle(askerHandleRaw.replace(/^@/, ''))
    } catch (e) {
      const msg = e instanceof InvalidWorkspaceHandleError ? e.message : 'Invalid handle.'
      return { error: 'invalid_handle', message: msg, status: 400 }
    }
    const dirEntry = await resolveConfirmedHandle({
      handle: normalized,
      excludeUserId: ctxTenantId,
    })
    if (!dirEntry) {
      return { error: 'handle_not_found', message: `No Braintunnel user @${normalized}.`, status: 400 }
    }
    return { askerId: dirEntry.userId }
  }
  const resolved = await resolveUserIdByPrimaryEmail({
    email: askerEmailRaw,
    excludeUserId: ctxTenantId,
  })
  if (!resolved) {
    return {
      error: 'asker_not_found',
      message: 'No Braintunnel user has that mailbox as their primary email.',
      status: 400,
    }
  }
  return { askerId: resolved }
}

const brainQuery = new Hono()

brainQuery.get('/grants', async (c) => {
  const ctx = getTenantContext()
  const ownedRows = listBrainQueryGrantsForOwner(ctx.tenantUserId)
  const receivedRows = listBrainQueryGrantsForAsker(ctx.tenantUserId)
  const grantedByMe = await Promise.all(ownedRows.map((r) => toApiGrant(r)))
  const grantedToMe = await Promise.all(receivedRows.map((r) => toApiGrant(r)))
  return c.json({ grantedByMe, grantedToMe })
})

brainQuery.post('/grants', async (c) => {
  const ctx = getTenantContext()
  let body: {
    askerEmail?: unknown
    askerHandle?: unknown
    askerUserId?: unknown
    privacyPolicy?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const askerEmailRaw = typeof body.askerEmail === 'string' ? body.askerEmail.trim() : ''
  const askerHandleRaw = typeof body.askerHandle === 'string' ? body.askerHandle.trim() : ''
  const askerUserIdRaw = typeof body.askerUserId === 'string' ? body.askerUserId.trim() : ''
  const privacyPolicy = typeof body.privacyPolicy === 'string' ? body.privacyPolicy : undefined
  const modes = [askerEmailRaw, askerHandleRaw, askerUserIdRaw].filter((s) => s.length > 0)
  if (modes.length === 0) {
    return c.json({ error: 'asker_required', message: 'Provide askerUserId, handle, or email.' }, 400)
  }
  if (modes.length > 1) {
    return c.json(
      { error: 'asker_conflict', message: 'Provide only one of askerUserId, handle, or email.' },
      400,
    )
  }
  const resolved = await resolveAskerUserId({
    ctxTenantId: ctx.tenantUserId,
    askerUserIdRaw,
    askerHandleRaw,
    askerEmailRaw,
  })
  if ('error' in resolved) {
    return c.json({ error: resolved.error, message: resolved.message }, resolved.status)
  }
  try {
    const row = createBrainQueryGrant({
      ownerId: ctx.tenantUserId,
      askerId: resolved.askerId,
      ...(privacyPolicy !== undefined ? { privacyPolicy } : {}),
    })
    const api = await toApiGrant(row)
    try {
      await createNotificationForTenant(resolved.askerId, {
        sourceKind: 'brain_query_grant_received',
        idempotencyKey: `brain_query_grant:${row.id}`,
        payload: {
          grantId: row.id,
          ownerId: ctx.tenantUserId,
          ownerHandle: api.ownerHandle,
          privacyPolicyPreview: grantPrivacyPolicyPreview(row.privacy_policy),
          createdAtMs: row.created_at_ms,
        },
      })
    } catch (e: unknown) {
      brainLogger.warn({ err: e }, '[brain-query] notify asker for new grant failed')
    }
    return c.json(api)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'create_failed'
    if (msg.includes('SQLITE_CONSTRAINT') || msg.includes('UNIQUE')) {
      return c.json(
        { error: 'grant_exists', message: 'A grant for this collaborator already exists.' },
        409,
      )
    }
    if (msg === 'owner_and_asker_required' || msg === 'asker_is_owner') {
      return c.json({ error: msg }, 400)
    }
    return c.json({ error: 'create_failed', message: msg }, 500)
  }
})

brainQuery.patch('/grants/:id', async (c) => {
  const ctx = getTenantContext()
  const id = c.req.param('id')
  let body: { privacyPolicy?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const privacyPolicy = typeof body.privacyPolicy === 'string' ? body.privacyPolicy : ''
  if (!privacyPolicy.trim()) {
    return c.json({ error: 'privacyPolicy_required' }, 400)
  }
  const updated = updateBrainQueryGrantPrivacyPolicy({
    grantId: id,
    ownerId: ctx.tenantUserId,
    privacyPolicy,
  })
  if (!updated) {
    return c.json({ error: 'not_found_or_forbidden' }, 404)
  }
  const api = await toApiGrant(updated)
  return c.json(api)
})

brainQuery.delete('/grants/:id', async (c) => {
  const ctx = getTenantContext()
  const id = c.req.param('id')
  const row = getBrainQueryGrantById(id)
  if (!row) {
    return c.json({ error: 'not_found_or_forbidden' }, 404)
  }
  if (row.owner_id === ctx.tenantUserId) {
    const out = revokeBrainQueryGrantAndReciprocal({ grantId: id, ownerId: ctx.tenantUserId })
    if (!out.revoked) return c.json({ error: 'not_found_or_forbidden' }, 404)
    return c.json({ ok: true as const })
  }
  if (row.asker_id === ctx.tenantUserId) {
    const ok = revokeBrainQueryGrantAsAsker({ grantId: id, askerId: ctx.tenantUserId })
    if (!ok) return c.json({ error: 'not_found_or_forbidden' }, 404)
    return c.json({ ok: true as const })
  }
  return c.json({ error: 'not_found_or_forbidden' }, 404)
})

export default brainQuery
