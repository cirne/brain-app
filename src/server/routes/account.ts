import { Hono } from 'hono'
import type { Context } from 'hono'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { readPrimaryRipmailImapEmail } from '@server/lib/platform/googleOAuth.js'
import { readHandleMeta, markHandleConfirmed } from '@server/lib/tenant/handleMeta.js'
import {
  InvalidWorkspaceHandleError,
  parseWorkspaceHandle,
} from '@server/lib/tenant/workspaceHandle.js'
import { deriveWorkspaceHandleSeed, isDisplayHandleSlugAvailable } from '@server/lib/tenant/googleIdentityWorkspace.js'
import { lookupIdentityKeyForTenantUserId } from '@server/lib/tenant/tenantRegistry.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'

const app = new Hono()

/** Simple sliding-window rate limit for handle availability checks (per IP). */
const checkWindowMs = 60_000
const checkMaxPerWindow = 40
const checkHits = new Map<string, number[]>()

function rateLimitCheck(ip: string): boolean {
  const now = Date.now()
  const prev = checkHits.get(ip) ?? []
  const recent = prev.filter((t) => now - t < checkWindowMs)
  if (recent.length >= checkMaxPerWindow) return false
  recent.push(now)
  checkHits.set(ip, recent)
  return true
}

function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (fwd) return fwd
  return c.req.header('x-real-ip') ?? 'unknown'
}

/** Email local-part style suggestion for the handle picker (see {@link deriveWorkspaceHandleSeed}). */
function computeSuggestedHandle(tenantUserId: string, email: string, identityKey: string | null): string {
  const sub =
    identityKey && identityKey.startsWith('google:')
      ? identityKey.slice('google:'.length)
      : tenantUserId
  try {
    return deriveWorkspaceHandleSeed(email, sub)
  } catch {
    return ''
  }
}

function mt404(c: Context) {
  return c.json({ error: 'not_found', message: 'Account handle API is only available in hosted mode.' }, 404)
}

app.get('/handle', async (c) => {
  if (!isMultiTenantMode()) return mt404(c)
  const ctx = tryGetTenantContext()
  if (!ctx) {
    return c.json({ error: 'tenant_required' }, 401)
  }
  const meta = await readHandleMeta(ctx.homeDir)
  if (!meta) {
    return c.json({ error: 'handle_meta_missing', message: 'Workspace identity is not ready.' }, 500)
  }
  const identityKey = await lookupIdentityKeyForTenantUserId(ctx.tenantUserId)
  const email = (await readPrimaryRipmailImapEmail(ripmailHomeForBrain())) ?? ''
  const suggestedHandle = computeSuggestedHandle(ctx.tenantUserId, email, identityKey)
  return c.json({
    userId: meta.userId,
    handle: meta.handle,
    confirmedAt: meta.confirmedAt ?? null,
    suggestedHandle,
  })
})

app.get('/handle/check', async (c) => {
  if (!isMultiTenantMode()) return mt404(c)
  const ctx = tryGetTenantContext()
  if (!ctx) {
    return c.json({ error: 'tenant_required' }, 401)
  }
  const ip = clientIp(c)
  if (!rateLimitCheck(ip)) {
    return c.json({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' }, 429)
  }

  const raw = c.req.query('handle')?.trim() ?? ''
  let normalized: string
  try {
    normalized = parseWorkspaceHandle(raw)
  } catch (e) {
    const msg = e instanceof InvalidWorkspaceHandleError ? e.message : 'Invalid handle.'
    return c.json({ available: false as const, reason: 'invalid' as const, message: msg })
  }

  const identityKey = await lookupIdentityKeyForTenantUserId(ctx.tenantUserId)
  if (!identityKey) {
    return c.json({ error: 'identity_not_found' }, 500)
  }

  if (normalized === ctx.workspaceHandle) {
    return c.json({ available: true as const, handle: normalized })
  }

  const ok = await isDisplayHandleSlugAvailable(normalized, ctx.tenantUserId)
  if (!ok) {
    return c.json({ available: false as const, reason: 'taken' as const })
  }
  return c.json({ available: true as const, handle: normalized })
})

app.post('/handle/confirm', async (c) => {
  if (!isMultiTenantMode()) return mt404(c)
  const ctx = tryGetTenantContext()
  if (!ctx) {
    return c.json({ error: 'tenant_required' }, 401)
  }

  const body = (await c.req.json().catch(() => ({}))) as { handle?: string }
  const raw = typeof body.handle === 'string' ? body.handle : ''
  let requested: string
  try {
    requested = parseWorkspaceHandle(raw)
  } catch (e) {
    const msg = e instanceof InvalidWorkspaceHandleError ? e.message : 'Invalid handle.'
    return c.json({ error: 'invalid_handle', message: msg }, 400)
  }

  const meta = await readHandleMeta(ctx.homeDir)
  if (!meta) {
    return c.json({ error: 'handle_meta_missing' }, 500)
  }
  if (typeof meta.confirmedAt === 'string' && meta.confirmedAt.length > 0) {
    return c.json({ error: 'already_confirmed', message: 'Your handle is already confirmed.' }, 400)
  }

  const identityKey = await lookupIdentityKeyForTenantUserId(ctx.tenantUserId)
  if (!identityKey) {
    return c.json({ error: 'identity_not_found' }, 500)
  }

  if (requested !== meta.handle) {
    const ok = await isDisplayHandleSlugAvailable(requested, ctx.tenantUserId)
    if (!ok) {
      return c.json({ error: 'handle_taken', message: 'That handle is taken. Try another.' }, 400)
    }
  }

  await markHandleConfirmed(ctx.homeDir, requested, meta.userId)

  return c.json({ ok: true as const, handle: requested })
})

export default app
