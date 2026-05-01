import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { isMultiTenantMode, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import {
  lookupTenantBySession,
  unregisterSessionTenant,
} from '@server/lib/tenant/tenantRegistry.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { revokeVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { BRAIN_SESSION_COOKIE, clearBrainSessionCookie } from '@server/lib/vault/vaultCookie.js'
import { vaultVerifierExistsSync } from '@server/lib/vault/vaultVerifierStore.js'

type LogoutJsonBody =
  | {
      ok: true
      vaultExists: false
      unlocked: false
      multiTenant: true
    }
  | {
      ok: true
      vaultExists: boolean
      unlocked: false
    }

/**
 * Same session teardown as POST /api/vault/logout — revokes server session, clears cookie on `c`.
 */
export async function executeVaultLogout(c: Context): Promise<LogoutJsonBody> {
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
    return {
      ok: true,
      vaultExists: false,
      unlocked: false,
      multiTenant: true as const,
    }
  }
  if (sid) {
    await revokeVaultSession(sid)
  }
  clearBrainSessionCookie(c)
  return {
    ok: true,
    vaultExists: vaultVerifierExistsSync(),
    unlocked: false,
  }
}

/** Same-origin path only — default `/`. */
export function safeLogoutRedirectPath(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return '/'
  }
  return next
}
