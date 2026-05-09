import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { revokeVaultSession, validateVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { BRAIN_SESSION_COOKIE, clearBrainSessionCookie } from '@server/lib/vault/vaultCookie.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import {
  removeIdentityMappingsForTenantUserId,
  unregisterSessionTenant,
} from '@server/lib/tenant/tenantRegistry.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { executeVaultLogout } from '@server/lib/vault/vaultLogoutCore.js'
import { B2B_ENABLED } from '@server/lib/features.js'

const vault = new Hono()

type StatusBody = {
  /** True when a valid session cookie is present. */
  unlocked: boolean
  multiTenant: true
  workspaceHandle?: string
  userId?: string
  handleConfirmed?: boolean
  /** Cross-workspace brain query (brain-to-brain); true only when `BRAIN_B2B_ENABLED` is `1` or `true`. */
  brainQueryEnabled: boolean
}

async function vaultStatusHandler(c: Context) {
  if (!tryGetTenantContext()) {
    return c.json({
      unlocked: false,
      multiTenant: true,
      brainQueryEnabled: B2B_ENABLED,
    } satisfies StatusBody)
  }

  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const unlocked = await validateVaultSession(sid)
  const ctx = tryGetTenantContext()
  const workspaceHandle =
    ctx && ctx.workspaceHandle !== '_single' ? ctx.workspaceHandle : undefined
  const extraMt: Partial<Pick<StatusBody, 'userId' | 'handleConfirmed'>> = {}
  if (ctx && unlocked && workspaceHandle) {
    const meta = await readHandleMeta(ctx.homeDir)
    if (meta?.userId) extraMt.userId = meta.userId
    extraMt.handleConfirmed = !!(
      meta &&
      typeof meta.confirmedAt === 'string' &&
      meta.confirmedAt.length > 0
    )
  }
  return c.json({
    unlocked,
    multiTenant: true as const,
    brainQueryEnabled: B2B_ENABLED,
    ...(workspaceHandle ? { workspaceHandle } : {}),
    ...extraMt,
  } satisfies StatusBody)
}

/** GET/POST /api/vault/status — public (bootstrap UI). */
vault.get('/status', vaultStatusHandler)
vault.post('/status', vaultStatusHandler)

/** End session (clears cookie even when session expired or missing). */
vault.post('/logout', async (c) => {
  const body = await executeVaultLogout(c)
  return c.json(body)
})

/**
 * Wipe this tenant’s directory, clear identity mapping, end session.
 * Requires a valid session (tenant context).
 */
vault.post('/delete-all-data', async (c) => {
  const ctx = tryGetTenantContext()
  if (!ctx || ctx.tenantUserId === '_single') {
    return c.json({ error: 'tenant_required', message: 'Sign in to continue.' }, 401)
  }
  const tid = ctx.tenantUserId
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)

  if (sid) {
    await revokeVaultSession(sid)
  }
  await removeIdentityMappingsForTenantUserId(tid)
  await unregisterSessionTenant(sid)

  const home = tenantHomeDir(tid)
  if (existsSync(home)) {
    await rm(home, { recursive: true, force: true })
  }

  clearBrainSessionCookie(c)
  return c.json({
    ok: true,
    unlocked: false,
    multiTenant: true as const,
    brainQueryEnabled: B2B_ENABLED,
  } satisfies { ok: true } & StatusBody)
})

export default vault
