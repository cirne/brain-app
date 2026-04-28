import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { BRAIN_SESSION_COOKIE } from './vaultCookie.js'
import { validateVaultSession } from './vaultSessionStore.js'
import { vaultVerifierExistsSync } from './vaultVerifierStore.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { isIssuesEmbedGetPath, isValidEmbedKeyBearer } from './embedKeyAuth.js'
import { isIngestDevicePath, resolveDeviceTokenFromBearer } from './deviceTokenAuth.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { isEnronDemoPublicApiPath } from '@server/lib/auth/enronDemo.js'

/** Dev-only POST shims used by {@link App.svelte} before vault session exists. */
function isDevBootstrapPost(path: string, method: string): boolean {
  if (method !== 'POST') return false
  if (process.env.NODE_ENV === 'production') return false
  return (
    path === '/api/dev/hard-reset' ||
    path === '/api/dev/restart-seed' ||
    path === '/api/dev/first-chat'
  )
}

/** GET /api/onboarding/status allowed without vault so the client can route first-run onboarding. */
function isBootstrapOnboardingStatus(path: string, method: string): boolean {
  return method === 'GET' && path === '/api/onboarding/status'
}

function isVaultPublic(path: string, method: string): boolean {
  if (path === '/api/vault/status' && (method === 'GET' || method === 'POST')) return true
  if (path === '/api/vault/setup' && method === 'POST') return true
  if (path === '/api/vault/unlock' && method === 'POST') return true
  /** Clear cookie even when session expired or missing. */
  if (path === '/api/vault/logout' && method === 'POST') return true
  return false
}

function isOAuthPublic(path: string): boolean {
  return path.startsWith('/api/oauth/google')
}

/**
 * Requires a vault session cookie when a vault verifier exists.
 * Without a vault, allows bootstrap routes only (vault setup + onboarding status GET).
 */
export async function vaultGateMiddleware(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path
  const method = c.req.method

  if (isOAuthPublic(path)) {
    return next()
  }

  if (isDevBootstrapPost(path, method)) {
    return next()
  }

  /** OPP-051 Phase 0: handler returns 404/501; path must bypass vault for mint + seed-status. */
  if (isEnronDemoPublicApiPath(path, method)) {
    return next()
  }

  /** OPP-048: list/fetch issues with `BRAIN_EMBED_MASTER_KEY` (operator / coding agent; global queue in MT). */
  if (isIssuesEmbedGetPath(path, method) && isValidEmbedKeyBearer(c)) {
    return next()
  }

  if (isIngestDevicePath(path, method)) {
    const resolved = await resolveDeviceTokenFromBearer(c)
    if (resolved?.scopes.includes('ingest:imessage')) {
      return next()
    }
  }

  if (isMultiTenantMode()) {
    const ctx = tryGetTenantContext()
    const sid = getCookie(c, BRAIN_SESSION_COOKIE)
    const sessionOk = ctx ? await validateVaultSession(sid) : false
    if (ctx && sessionOk) {
      return next()
    }
    if (isVaultPublic(path, method) || isBootstrapOnboardingStatus(path, method)) {
      return next()
    }
    return c.json(
      { error: 'auth_required', message: 'Sign in with Google to continue.' },
      401,
    )
  }

  const hasVault = vaultVerifierExistsSync()

  if (!hasVault) {
    if (isVaultPublic(path, method) || isBootstrapOnboardingStatus(path, method)) {
      return next()
    }
    return c.json({ error: 'vault_required', message: 'Create your vault password first.' }, 401)
  }

  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const ok = await validateVaultSession(sid)

  if (ok) {
    return next()
  }

  if (isVaultPublic(path, method)) {
    return next()
  }

  return c.json({ error: 'unlock_required', message: 'Unlock your vault to continue.' }, 401)
}
