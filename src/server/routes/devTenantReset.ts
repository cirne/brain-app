import type { Context } from 'hono'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { clearAllSessions } from '@server/agent/assistantAgent.js'
import { clearAllInterviewSessions } from '@server/agent/onboardingInterviewAgent.js'
import { clearAllWikiBuildoutSessions } from '@server/agent/wikiBuildoutAgent.js'
import { executeTenantSoftReset } from '@server/lib/dev/tenantSoftReset.js'
import { deleteWikiSharesForOwner } from '@server/lib/shares/wikiSharesRepo.js'
import { hardResetOnboardingArtifacts } from '@server/lib/onboarding/onboardingState.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { lookupTenantBySession } from '@server/lib/tenant/tenantRegistry.js'
import { isDevRuntime } from '@server/lib/platform/isDevRuntime.js'
import { BRAIN_SESSION_COOKIE, clearBrainSessionCookie } from '@server/lib/vault/vaultCookie.js'
import { validateVaultSession } from '@server/lib/vault/vaultSessionStore.js'

function devResetDisabledResponse(): Response {
  return new Response(null, { status: 404 })
}

/** Browser GET: redirect to app shell; API/curl: JSON. */
function jsonOrRedirectAfterBrowserGet(
  c: Context,
  payload: { ok: true; mode: 'soft' | 'hard'; message: string },
): Response {
  const accept = c.req.header('accept') ?? ''
  if (c.req.method === 'GET' && accept.includes('text/html')) {
    const loc = payload.mode === 'hard' ? '/' : '/welcome'
    return c.redirect(loc, 302)
  }
  return c.json(payload)
}

async function handleSoftReset(c: Context): Promise<Response> {
  if (!isDevRuntime()) return devResetDisabledResponse()

  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  if (!sid || sid.length < 16) {
    return c.json({ error: 'auth_required', message: 'Sign in with Google to continue.' }, 401)
  }
  const tenantUserId = await lookupTenantBySession(sid)
  if (!tenantUserId) {
    return c.json({ error: 'tenant_required', message: 'Sign in with Google to continue.' }, 401)
  }

  const homeDir = tenantHomeDir(tenantUserId)
  const meta = await readHandleMeta(homeDir)
  const workspaceHandle = meta?.handle ?? tenantUserId
  const ctx = { tenantUserId, workspaceHandle, homeDir }

  /** `/reset` skips `/api/*` tenant middleware — vault session IO uses {@link brainHome()} and needs ALS. */
  return runWithTenantContextAsync(ctx, async () => {
    if (!(await validateVaultSession(sid))) {
      return c.json({ error: 'auth_required', message: 'Sign in with Google to continue.' }, 401)
    }

    clearAllSessions()
    clearAllInterviewSessions()
    clearAllWikiBuildoutSessions()

    await executeTenantSoftReset(tenantUserId)

    return jsonOrRedirectAfterBrowserGet(c, {
      ok: true,
      mode: 'soft',
      message:
        'Wiki and chat cleared; ripmail preserved; onboarding set to guided interview. Reload the app.',
    })
  })
}

async function handleHardReset(c: Context): Promise<Response> {
  if (!isDevRuntime()) return devResetDisabledResponse()

  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  if (!sid || sid.length < 16) {
    return c.json({ error: 'auth_required', message: 'Sign in with Google to continue.' }, 401)
  }
  const tenantUserId = await lookupTenantBySession(sid)
  if (!tenantUserId) {
    return c.json({ error: 'tenant_required', message: 'Sign in with Google to continue.' }, 401)
  }

  const homeDir = tenantHomeDir(tenantUserId)
  const meta = await readHandleMeta(homeDir)
  const workspaceHandle = meta?.handle ?? tenantUserId
  const ctx = { tenantUserId, workspaceHandle, homeDir }

  return runWithTenantContextAsync(ctx, async () => {
    if (!(await validateVaultSession(sid))) {
      return c.json({ error: 'auth_required', message: 'Sign in with Google to continue.' }, 401)
    }

    clearAllSessions()
    clearAllInterviewSessions()
    clearAllWikiBuildoutSessions()

    deleteWikiSharesForOwner(tenantUserId)
    await hardResetOnboardingArtifacts()
    ensureTenantHomeDir(tenantUserId)

    clearBrainSessionCookie(c)
    return jsonOrRedirectAfterBrowserGet(c, {
      ok: true,
      mode: 'hard',
      message: 'Tenant data wiped including ripmail and sessions. Session cookie cleared — sign in again.',
    })
  })
}

export function registerDevTenantResetRoutes(app: Hono): void {
  app.post('/reset', handleSoftReset)
  app.get('/reset', handleSoftReset)
  app.post('/hard-reset', handleHardReset)
  app.get('/hard-reset', handleHardReset)
}
