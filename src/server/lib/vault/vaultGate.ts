import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { getInboundOrAckedBrainSessionId } from './vaultSessionSameRequestAck.js'
import { BRAIN_SESSION_COOKIE } from './vaultCookie.js'
import { validateVaultSession } from './vaultSessionStore.js'
import { vaultVerifierExistsSync } from './vaultVerifierStore.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { isIssuesEmbedGetPath, isValidEmbedKeyBearer } from './embedKeyAuth.js'
import { isIngestDevicePath, resolveDeviceTokenFromBearer } from './deviceTokenAuth.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { isEnronDemoPublicApiPath } from '@server/lib/auth/enronDemo.js'
import {
  isDevBootstrapPostPath,
  isOnboardingStatusPublicPath,
  isVaultPublicRoute,
} from '@server/lib/auth/publicRoutePolicy.js'

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

  if (isDevBootstrapPostPath(path, method)) {
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
    if (isVaultPublicRoute(path, method) || isOnboardingStatusPublicPath(path, method)) {
      return next()
    }
    return c.json(
      { error: 'auth_required', message: 'Sign in with Google to continue.' },
      401,
    )
  }

  const hasVault = vaultVerifierExistsSync()

  if (!hasVault) {
    if (isVaultPublicRoute(path, method) || isOnboardingStatusPublicPath(path, method)) {
      return next()
    }
    return c.json({ error: 'vault_required', message: 'Create your vault password first.' }, 401)
  }

  const sidForValidation = getInboundOrAckedBrainSessionId(c)
  const ok = sidForValidation ? await validateVaultSession(sidForValidation) : false

  if (ok) {
    return next()
  }

  if (isVaultPublicRoute(path, method)) {
    return next()
  }

  return c.json({ error: 'unlock_required', message: 'Unlock your vault to continue.' }, 401)
}
