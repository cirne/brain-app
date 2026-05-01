import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { BRAIN_SESSION_COOKIE } from './vaultCookie.js'
import { validateVaultSession } from './vaultSessionStore.js'
import { isIssuesEmbedGetPath, isValidEmbedKeyBearer } from './embedKeyAuth.js'
import { isIngestDevicePath, resolveDeviceTokenFromBearer } from './deviceTokenAuth.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { isEnronDemoPublicApiPath } from '@server/lib/auth/enronDemo.js'
import {
  isOnboardingStatusPublicPath,
  isVaultPublicRoute,
} from '@server/lib/auth/publicRoutePolicy.js'

function isOAuthPublic(path: string): boolean {
  return path.startsWith('/api/oauth/google')
}

/**
 * Requires a valid vault session cookie when tenant context is established.
 */
export async function vaultGateMiddleware(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path
  const method = c.req.method

  if (isOAuthPublic(path)) {
    return next()
  }

  /** OPP-051 Phase 0: handler returns 404/501; path must bypass vault for mint + seed-status. */
  if (isEnronDemoPublicApiPath(path, method)) {
    return next()
  }

  /** OPP-048: list/fetch issues with `BRAIN_EMBED_MASTER_KEY`. */
  if (isIssuesEmbedGetPath(path, method) && isValidEmbedKeyBearer(c)) {
    return next()
  }

  if (isIngestDevicePath(path, method)) {
    const resolved = await resolveDeviceTokenFromBearer(c)
    if (resolved?.scopes.includes('ingest:imessage')) {
      return next()
    }
  }

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
