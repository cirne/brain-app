import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { resolveBrainHomeDiskRoot } from './brainHome.js'
import { isMultiTenantMode, tenantHomeDir } from './dataRoot.js'
import { runWithTenantContextAsync } from './tenantContext.js'
import { lookupTenantBySession } from './tenantRegistry.js'
import { BRAIN_SESSION_COOKIE } from './vaultCookie.js'
import { ensureDefaultSkillsSeeded } from './skillsSeeder.js'

const mtSkillsSeeded = new Set<string>()

/** Multi-tenant: allow these without a mapped session (handler uses explicit tenant or synthetic response). */
function allowNoTenantContextMt(path: string, method: string): boolean {
  /** Google OAuth (PKCE); callback runs before `brain_session` exists. */
  if (path.startsWith('/api/oauth/google')) return true
  if (path === '/api/vault/status' && (method === 'GET' || method === 'POST')) return true
  if (path === '/api/vault/setup' && method === 'POST') return true
  if (path === '/api/vault/unlock' && method === 'POST') return true
  if (path === '/api/vault/logout' && method === 'POST') return true
  if (path === '/api/onboarding/status' && method === 'GET') return true
  return false
}

/**
 * Establishes per-request tenant home directory (AsyncLocalStorage).
 * Single-tenant: wraps every `/api/*` request with `{ _single, resolveBrainHomeDiskRoot() }`.
 * Multi-tenant: maps `brain_session` cookie via global registry, or allows a small bootstrap allowlist.
 */
export async function tenantMiddleware(c: Context, next: Next): Promise<Response | void> {
  if (!isMultiTenantMode()) {
    const homeDir = resolveBrainHomeDiskRoot()
    return runWithTenantContextAsync({ workspaceHandle: '_single', homeDir }, () => next())
  }

  const path = c.req.path
  const method = c.req.method
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const workspaceHandle = await lookupTenantBySession(sid)
  if (workspaceHandle) {
    const homeDir = tenantHomeDir(workspaceHandle)
    return runWithTenantContextAsync({ workspaceHandle, homeDir }, async () => {
      if (!mtSkillsSeeded.has(workspaceHandle)) {
        await ensureDefaultSkillsSeeded()
        mtSkillsSeeded.add(workspaceHandle)
      }
      return next()
    })
  }

  if (allowNoTenantContextMt(path, method)) {
    return next()
  }

  return c.json(
    {
      error: 'tenant_required',
      message: 'Sign in with Google to continue.',
    },
    401,
  )
}
