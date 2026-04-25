import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import {
  VAULT_PASSWORD_MIN_LEN,
  createVaultVerifierRecord,
  verifyVaultPassword,
} from '@server/lib/vault/vaultCrypto.js'
import { readVaultVerifier, writeVaultVerifier, vaultVerifierExistsSync } from '@server/lib/vault/vaultVerifierStore.js'
import { createVaultSession, revokeVaultSession, validateVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import {
  BRAIN_SESSION_COOKIE,
  clearBrainSessionCookie,
  setBrainSessionCookie,
} from '@server/lib/vault/vaultCookie.js'
import { isMultiTenantMode, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import {
  lookupTenantBySession,
  removeIdentityMappingsForTenantUserId,
  unregisterSessionTenant,
} from '@server/lib/tenant/tenantRegistry.js'
import { runWithTenantContextAsync, tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
const vault = new Hono()

type StatusBody = {
  vaultExists: boolean
  /** True when a valid session cookie is present. */
  unlocked: boolean
  /** True when `BRAIN_DATA_ROOT` is set (hosted: Google OAuth session; no vault password). */
  multiTenant?: boolean
  /** Present in multi-tenant mode after setup / unlock so clients can reconnect without cookie. */
  workspaceHandle?: string
  /** Hosted: stable non-PII id for telemetry when session is valid. */
  userId?: string
  /** Hosted: true after user confirms handle during onboarding. */
  handleConfirmed?: boolean
}

async function vaultStatusHandler(c: Context) {
  if (isMultiTenantMode() && !tryGetTenantContext()) {
    return c.json({ vaultExists: false, unlocked: false, multiTenant: true } satisfies StatusBody)
  }

  if (isMultiTenantMode()) {
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
      vaultExists: true,
      unlocked,
      multiTenant: true as const,
      ...(workspaceHandle ? { workspaceHandle } : {}),
      ...extraMt,
    } satisfies StatusBody)
  }

  const exists = vaultVerifierExistsSync()
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const unlocked = exists && (await validateVaultSession(sid))
  const ctx = tryGetTenantContext()
  const workspaceHandle =
    ctx && ctx.workspaceHandle !== '_single' ? ctx.workspaceHandle : undefined
  return c.json({
    vaultExists: exists,
    unlocked,
    ...(workspaceHandle ? { workspaceHandle } : {}),
  } satisfies StatusBody)
}

/** GET/POST /api/vault/status — public (bootstrap UI). */
vault.get('/status', vaultStatusHandler)
vault.post('/status', vaultStatusHandler)

/** First-run: create vault password and start a session. */
vault.post('/setup', async (c) => {
  if (isMultiTenantMode()) {
    return c.json(
      { error: 'Use Google sign-in to create your workspace.' },
      405,
    )
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    password?: string
    confirm?: string
    workspaceHandle?: string
  }
  const password = typeof body.password === 'string' ? body.password : ''
  const confirm = typeof body.confirm === 'string' ? body.confirm : ''

  const runSetup = async (): Promise<Response> => {
    if (vaultVerifierExistsSync()) {
      return c.json({ error: 'Vault already exists. Use unlock or reset data.' }, 400)
    }
    if (password.length < VAULT_PASSWORD_MIN_LEN) {
      return c.json(
        { error: `Password must be at least ${VAULT_PASSWORD_MIN_LEN} characters.` },
        400,
      )
    }
    if (password !== confirm) {
      return c.json({ error: 'Passwords do not match.' }, 400)
    }
    const record = await createVaultVerifierRecord(password)
    await writeVaultVerifier(record)
    const sessionId = await createVaultSession()
    setBrainSessionCookie(c, sessionId)
    const wh = tryGetTenantContext()?.workspaceHandle
    return c.json({
      ok: true,
      vaultExists: true,
      unlocked: true,
      ...(wh && wh !== '_single' ? { workspaceHandle: wh } : {}),
    } satisfies StatusBody & { ok: true })
  }

  return runSetup()
})

/** Unlock with vault password. */
vault.post('/unlock', async (c) => {
  if (isMultiTenantMode()) {
    return c.json({ error: 'Use Google sign-in to access your workspace.' }, 405)
  }
  const body = (await c.req.json().catch(() => ({}))) as { password?: string; workspaceHandle?: string }
  const password = typeof body.password === 'string' ? body.password : ''

  const runUnlock = async (): Promise<Response> => {
    if (!vaultVerifierExistsSync()) {
      return c.json({ error: 'No vault found. Complete setup first.' }, 400)
    }
    const record = await readVaultVerifier()
    if (!record) {
      return c.json({ error: 'Vault data is missing or invalid.' }, 500)
    }
    const good = await verifyVaultPassword(password, record)
    if (!good) {
      return c.json({ error: 'That password did not match.' }, 401)
    }
    const sessionId = await createVaultSession()
    setBrainSessionCookie(c, sessionId)
    const wh = tryGetTenantContext()?.workspaceHandle
    return c.json({
      ok: true,
      vaultExists: true,
      unlocked: true,
      ...(wh && wh !== '_single' ? { workspaceHandle: wh } : {}),
    } satisfies StatusBody & { ok: true })
  }

  return runUnlock()
})

/** End session (clears cookie even when session expired or missing). */
vault.post('/logout', async (c) => {
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  if (isMultiTenantMode()) {
    if (sid) {
      const tid = await lookupTenantBySession(sid)
      if (tid) {
        const homeDir = tenantHomeDir(tid)
        const meta = await readHandleMeta(homeDir)
        const workspaceHandle = meta?.handle ?? tid
        await runWithTenantContextAsync(
          { tenantUserId: tid, workspaceHandle, homeDir },
          async () => {
            await revokeVaultSession(sid)
          },
        )
      }
      await unregisterSessionTenant(sid)
    }
    clearBrainSessionCookie(c)
    return c.json({
      ok: true,
      vaultExists: false,
      unlocked: false,
      multiTenant: true as const,
    } satisfies StatusBody & { ok: true })
  }
  if (sid) {
    await revokeVaultSession(sid)
  }
  clearBrainSessionCookie(c)
  return c.json({ ok: true, vaultExists: vaultVerifierExistsSync(), unlocked: false } satisfies StatusBody & {
    ok: true
  })
})

/**
 * Hosted multi-tenant only: wipe this tenant’s directory, clear identity mapping, end session.
 * Requires a valid session (tenant context); not available in single-tenant / desktop local mode.
 */
vault.post('/delete-all-data', async (c) => {
  if (!isMultiTenantMode()) {
    return c.json({ error: 'not_available', message: 'This action is only available in hosted mode.' }, 404)
  }
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
    vaultExists: false,
    unlocked: false,
    multiTenant: true as const,
  } satisfies StatusBody & { ok: true })
})

export default vault
