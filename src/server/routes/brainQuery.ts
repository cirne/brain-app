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
  createBrainQueryCustomPolicy,
  deleteBrainQueryCustomPolicy,
  listBrainQueryCustomPoliciesForOwner,
  updateBrainQueryCustomPolicy,
} from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import {
  createBrainQueryGrant,
  getActiveBrainQueryGrant,
  getBrainQueryGrantById,
  listBrainQueryGrantsForAsker,
  listBrainQueryGrantsForOwner,
  revokeBrainQueryGrantAndReciprocal,
  revokeBrainQueryGrantAsAsker,
  updateBrainQueryGrantPrivacyInstructions,
  type BrainQueryGrantRow,
} from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { resolveGrantPrivacyInstructions } from '@server/lib/brainQuery/resolveGrantPrivacyInstructions.js'
import { deleteOwnerInboundForRevokedBrainQueryGrant } from '@server/lib/chat/brainTunnelInboundCleanup.js'
import { isBrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'

const GRANT_POLICY_PREVIEW_MAX = 200

function grantPrivacyPolicyPreview(policy: string): string {
  const t = policy.trim()
  if (t.length <= GRANT_POLICY_PREVIEW_MAX) return t
  return `${t.slice(0, GRANT_POLICY_PREVIEW_MAX - 1)}…`
}

export type BrainQueryCustomPolicyApi = {
  id: string
  ownerId: string
  title: string
  body: string
  createdAtMs: number
  updatedAtMs: number
}

function toCustomPolicyApi(row: {
  id: string
  owner_id: string
  title: string
  body: string
  created_at_ms: number
  updated_at_ms: number
}): BrainQueryCustomPolicyApi {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    body: row.body,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  }
}

export type BrainQueryGrantApi = {
  id: string
  ownerId: string
  ownerHandle: string
  askerId: string
  askerHandle?: string
  presetPolicyKey: string | null
  customPolicyId: string | null
  /** Resolved privacy instructions (preset from `.hbs` or custom row body). */
  privacyPolicy: string
  /** @deprecated Prefer {@link replyMode}; true when replyMode is `auto`. */
  autoSend: boolean
  replyMode: 'auto' | 'review' | 'ignore'
  /** @deprecated Prefer {@link replyMode}. */
  policy: 'auto' | 'review' | 'ignore'
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
  const resolved = resolveGrantPrivacyInstructions(row)
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerHandle: ownerMeta?.handle ?? row.owner_id,
    askerId: row.asker_id,
    ...(askerHandle ? { askerHandle } : {}),
    presetPolicyKey: row.preset_policy_key,
    customPolicyId: row.custom_policy_id,
    privacyPolicy: resolved,
    autoSend: row.reply_mode === 'auto',
    replyMode: row.reply_mode,
    policy: row.reply_mode,
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

brainQuery.get('/policies', async (c) => {
  const ctx = getTenantContext()
  const rows = listBrainQueryCustomPoliciesForOwner(ctx.tenantUserId)
  return c.json({ policies: rows.map(toCustomPolicyApi) })
})

brainQuery.post('/policies', async (c) => {
  const ctx = getTenantContext()
  let body: { title?: unknown; label?: unknown; body?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const titleFromBody =
    typeof body.title === 'string'
      ? body.title
      : typeof body.label === 'string'
        ? body.label
        : ''
  const text = typeof body.body === 'string' ? body.body : ''
  try {
    const row = createBrainQueryCustomPolicy({
      ownerId: ctx.tenantUserId,
      title: titleFromBody,
      body: text,
    })
    return c.json(toCustomPolicyApi(row))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'create_failed'
    if (msg === 'title_required' || msg === 'body_required') {
      return c.json({ error: msg }, 400)
    }
    return c.json({ error: 'create_failed', message: msg }, 500)
  }
})

brainQuery.patch('/policies/:id', async (c) => {
  const ctx = getTenantContext()
  const id = c.req.param('id')
  let body: { title?: unknown; label?: unknown; body?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const title =
    body.title !== undefined && typeof body.title === 'string'
      ? body.title
      : body.label !== undefined && typeof body.label === 'string'
        ? body.label
        : undefined
  const text = body.body !== undefined && typeof body.body === 'string' ? body.body : undefined
  if (title === undefined && text === undefined) {
    return c.json({ error: 'no_updates' }, 400)
  }
  const updated = updateBrainQueryCustomPolicy({
    policyId: id,
    ownerId: ctx.tenantUserId,
    ...(title !== undefined ? { title } : {}),
    ...(text !== undefined ? { body: text } : {}),
  })
  if (!updated) {
    return c.json({ error: 'not_found_or_forbidden' }, 404)
  }
  return c.json(toCustomPolicyApi(updated))
})

brainQuery.delete('/policies/:id', async (c) => {
  const ctx = getTenantContext()
  const id = c.req.param('id')
  const out = deleteBrainQueryCustomPolicy({ policyId: id, ownerId: ctx.tenantUserId })
  if (!out.ok) {
    if (out.reason === 'in_use') {
      return c.json({ error: 'policy_in_use', message: 'Remove or reassign grants using this policy first.' }, 409)
    }
    return c.json({ error: 'not_found_or_forbidden' }, 404)
  }
  return c.json({ ok: true as const })
})

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
    presetPolicyKey?: unknown
    customPolicyId?: unknown
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const askerEmailRaw = typeof body.askerEmail === 'string' ? body.askerEmail.trim() : ''
  const askerHandleRaw = typeof body.askerHandle === 'string' ? body.askerHandle.trim() : ''
  const askerUserIdRaw = typeof body.askerUserId === 'string' ? body.askerUserId.trim() : ''
  const presetRaw = typeof body.presetPolicyKey === 'string' ? body.presetPolicyKey.trim() : ''
  const presetPolicyKey = isBrainQueryBuiltinPolicyId(presetRaw) ? presetRaw : undefined
  const customRaw = typeof body.customPolicyId === 'string' ? body.customPolicyId.trim() : ''
  const customPolicyId = customRaw.length > 0 ? customRaw : undefined
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
  if (presetPolicyKey === undefined && customPolicyId === undefined) {
    return c.json(
      { error: 'grant_privacy_required', message: 'Provide exactly one of presetPolicyKey or customPolicyId.' },
      400,
    )
  }
  if (presetPolicyKey !== undefined && customPolicyId !== undefined) {
    return c.json(
      { error: 'grant_privacy_conflict', message: 'Provide only one of presetPolicyKey or customPolicyId.' },
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
      ...(presetPolicyKey !== undefined ? { presetPolicyKey } : {}),
      ...(customPolicyId !== undefined ? { customPolicyId } : {}),
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
          privacyPolicyPreview: grantPrivacyPolicyPreview(resolveGrantPrivacyInstructions(row)),
          createdAtMs: row.created_at_ms,
        },
      })
    } catch (e: unknown) {
      brainLogger.warn({ err: e }, '[brain-query] notify asker for new grant failed')
    }
    return c.json(api)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'create_failed'
    if (msg === 'grant_privacy_xor_invalid') {
      return c.json({ error: msg, message: 'Provide exactly one of presetPolicyKey or customPolicyId.' }, 400)
    }
    if (msg === 'custom_policy_not_found') {
      return c.json({ error: msg, message: 'Unknown or inaccessible custom policy id.' }, 400)
    }
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
  let body: { presetPolicyKey?: unknown; customPolicyId?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const presetRaw = typeof body.presetPolicyKey === 'string' ? body.presetPolicyKey.trim() : ''
  const presetPolicyKey = isBrainQueryBuiltinPolicyId(presetRaw) ? presetRaw : undefined
  const customRaw = typeof body.customPolicyId === 'string' ? body.customPolicyId.trim() : ''
  const customPolicyId = customRaw.length > 0 ? customRaw : undefined
  if (presetPolicyKey === undefined && customPolicyId === undefined) {
    return c.json(
      { error: 'grant_privacy_required', message: 'Provide exactly one of presetPolicyKey or customPolicyId.' },
      400,
    )
  }
  if (presetPolicyKey !== undefined && customPolicyId !== undefined) {
    return c.json(
      { error: 'grant_privacy_conflict', message: 'Provide only one of presetPolicyKey or customPolicyId.' },
      400,
    )
  }
  try {
    const updated = updateBrainQueryGrantPrivacyInstructions({
      grantId: id,
      ownerId: ctx.tenantUserId,
      ...(presetPolicyKey !== undefined ? { presetPolicyKey } : {}),
      ...(customPolicyId !== undefined ? { customPolicyId } : {}),
    })
    if (!updated) {
      return c.json({ error: 'not_found_or_forbidden' }, 404)
    }
    const api = await toApiGrant(updated)
    return c.json(api)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'update_failed'
    if (msg === 'grant_privacy_xor_invalid') {
      return c.json({ error: msg }, 400)
    }
    if (msg === 'custom_policy_not_found') {
      return c.json({ error: msg }, 400)
    }
    return c.json({ error: 'update_failed', message: msg }, 500)
  }
})

brainQuery.delete('/grants/:id', async (c) => {
  const ctx = getTenantContext()
  const id = c.req.param('id')
  const row = getBrainQueryGrantById(id)
  if (!row) {
    return c.json({ error: 'not_found_or_forbidden' }, 404)
  }
  if (row.owner_id === ctx.tenantUserId) {
    const reciprocalPeerToOwner = getActiveBrainQueryGrant({
      ownerId: row.asker_id,
      askerId: row.owner_id,
    })
    const out = revokeBrainQueryGrantAndReciprocal({ grantId: id, ownerId: ctx.tenantUserId })
    if (!out.revoked) return c.json({ error: 'not_found_or_forbidden' }, 404)
    await deleteOwnerInboundForRevokedBrainQueryGrant(row)
    if (reciprocalPeerToOwner) {
      await deleteOwnerInboundForRevokedBrainQueryGrant(reciprocalPeerToOwner)
    }
    return c.json({ ok: true as const })
  }
  if (row.asker_id === ctx.tenantUserId) {
    await deleteOwnerInboundForRevokedBrainQueryGrant(row)
    const ok = revokeBrainQueryGrantAsAsker({ grantId: id, askerId: ctx.tenantUserId })
    if (!ok) return c.json({ error: 'not_found_or_forbidden' }, 404)
    return c.json({ ok: true as const })
  }
  return c.json({ error: 'not_found_or_forbidden' }, 404)
})

export default brainQuery
