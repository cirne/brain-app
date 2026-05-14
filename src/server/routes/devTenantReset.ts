import type { Context } from 'hono'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { clearAllSessions } from '@server/agent/assistantAgent.js'
import { clearAllInterviewSessions } from '@server/agent/onboardingInterviewAgent.js'
import { clearAllWikiBuildoutSessions } from '@server/agent/wikiBuildoutAgent.js'
import { deleteBrainQueryGrantsForTenant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { executeTenantSoftReset } from '@server/lib/dev/tenantSoftReset.js'
import { deleteColdQueryRateLimitsForSenderHandle } from '@server/lib/global/coldQueryRateLimits.js'
import { notifyNotificationsChanged } from '@server/lib/hub/hubSseBroker.js'
import { hardResetOnboardingArtifacts } from '@server/lib/onboarding/onboardingState.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { lookupTenantBySession } from '@server/lib/tenant/tenantRegistry.js'
import { getTenantDb } from '@server/lib/tenant/tenantSqlite.js'
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
    /** Soft reset leaves onboarding at `onboarding-agent` (main chat bootstrap); skip `/onboarding/*` mismatch. */
    const loc = payload.mode === 'hard' ? '/' : '/c?devClientReset=1'
    return c.redirect(loc, 302)
  }
  return c.json(payload)
}

export async function devTenantSoftResetHandler(c: Context): Promise<Response> {
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

  /** Top-level `/reset` skips `/api/*` tenant middleware; `/api/dev/soft-reset` runs after it (hosted port-forward). */
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

export async function devTenantHardResetHandler(c: Context): Promise<Response> {
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

    await hardResetOnboardingArtifacts()
    /** Wipe already removed every `usr_*` and `.global`. Do not recreate the old tenant dir here —
     *  the registry is gone, so the next OAuth run would provision a second `usr_*` and strand this one. */

    clearBrainSessionCookie(c)
    return jsonOrRedirectAfterBrowserGet(c, {
      ok: true,
      mode: 'hard',
      message:
        'All data under BRAIN_DATA_ROOT removed (every tenant + .global). Session cookie cleared — sign in again.',
    })
  })
}

export async function devResetTunnelsHandler(c: Context): Promise<Response> {
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

    // 1. Global Grants
    deleteBrainQueryGrantsForTenant(tenantUserId)

    // 2. Global Rate Limits
    deleteColdQueryRateLimitsForSenderHandle(workspaceHandle)

    // 3. Tenant Sessions (B2B only)
    const db = getTenantDb()
    db.transaction(() => {
      db.prepare(
        `DELETE FROM chat_messages WHERE session_id IN (SELECT session_id FROM chat_sessions WHERE session_type IN ('b2b_inbound', 'b2b_outbound'))`,
      ).run()
      db.prepare(`DELETE FROM chat_sessions WHERE session_type IN ('b2b_inbound', 'b2b_outbound')`).run()

      // 4. Tenant Notifications (B2B only)
      db.prepare(
        `DELETE FROM notifications WHERE source_kind IN ('b2b_inbound_query', 'b2b_tunnel_outbound_updated')`,
      ).run()
    })()

    notifyNotificationsChanged()

    return jsonOrRedirectAfterBrowserGet(c, {
      ok: true,
      mode: 'soft',
      message: 'All tunnels and ACL grants for this tenant have been cleared.',
    })
  })
}

export function registerDevTenantResetRoutes(app: Hono): void {
  app.post('/reset', devTenantSoftResetHandler)
  app.get('/reset', devTenantSoftResetHandler)
  app.post('/hard-reset', devTenantHardResetHandler)
  app.get('/hard-reset', devTenantHardResetHandler)
  app.post('/reset-tunnels', devResetTunnelsHandler)
  app.get('/reset-tunnels', devResetTunnelsHandler)
}
