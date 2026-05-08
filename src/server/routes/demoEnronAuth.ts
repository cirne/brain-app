import { Hono } from 'hono'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta, isValidUserId } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { setBrainSessionCookie } from '@server/lib/vault/vaultCookie.js'
import type { EnronDemoRegistryUser } from '@server/lib/auth/enronDemo.js'
import {
  ensureEnronDemoHandleMetaFile,
  enronDemoSecretConfigured,
  enronDemoTenantIdEnvAllows,
  isValidEnronDemoBearer,
  isValidEnronDemoReseedRequest,
  listEnronDemoUsersPublic,
  resolveEnronDemoUserByKey,
} from '@server/lib/auth/enronDemo.js'
import {
  ensureProvisionedMarkerWhenMailReady,
  getEnronDemoSeedSnapshot,
  isEnronDemoTenantProvisioned,
  startEnronDemoForceReseed,
} from '@server/lib/auth/enronDemoSeed.js'

/** Operator hint when mint hits before `npm run brain:seed-enron-demo:*`. */
export const ENRON_DEMO_NOT_SEEDED_HINT =
  'Pre-seed Enron demo mail under BRAIN_DATA_ROOT first (e.g. npm run brain:seed-enron-demo:dev for all personas, or BRAIN_ENRON_DEMO_USER=lay npm run brain:seed-enron-demo). See docs/architecture/enron-demo-tenant.md.'

const app = new Hono()

/** GET /users — no Bearer; same “demo configured” gate as other demo routes. */
app.get('/enron/users', async (c) => {
  if (!enronDemoSecretConfigured()) {
    return c.json({ error: 'not_found' }, 404)
  }
  c.header('Cache-Control', 'no-store, must-revalidate')
  return c.json({ ok: true as const, users: listEnronDemoUsersPublic() })
})

function requireDataRoot(c: { json: (body: unknown, status?: number) => Response }): Response | string {
  const dataRoot = process.env.BRAIN_DATA_ROOT?.trim()
  if (!dataRoot) {
    return c.json(
      {
        error: 'server_misconfigured',
        message: 'BRAIN_DATA_ROOT is required for multi-tenant demo seed.',
      },
      503,
    )
  }
  return dataRoot
}

function resolveDemoUserFromKey(
  c: { json: (body: unknown, status?: number) => Response },
  rawKey: string | undefined,
): Response | EnronDemoRegistryUser {
  const key = (rawKey ?? 'kean').trim().toLowerCase()
  const user = resolveEnronDemoUserByKey(key)
  if (!user) {
    return c.json(
      {
        error: 'unknown_demo_user',
        message: `Unknown demo user "${rawKey ?? ''}".`,
      },
      400,
    )
  }
  if (!isValidUserId(user.tenantUserId)) {
    return c.json(
      {
        error: 'server_misconfigured',
        message: 'Demo registry tenantUserId must be usr_ plus 20 lowercase alphanumerics.',
      },
      503,
    )
  }
  if (!enronDemoTenantIdEnvAllows(user)) {
    return c.json(
      {
        error: 'server_misconfigured',
        message:
          'BRAIN_ENRON_DEMO_TENANT_ID is set but does not match this demo user; clear it or pick the matching account.',
      },
      503,
    )
  }
  return user
}

function bearerMintPrelude(
  c: Parameters<typeof isValidEnronDemoBearer>[0],
): Response | { dataRoot: string } {
  if (!enronDemoSecretConfigured()) {
    return c.json({ error: 'not_found' }, 404)
  }
  if (!isValidEnronDemoBearer(c)) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  const dr = requireDataRoot(c)
  if (dr instanceof Response) return dr
  return { dataRoot: dr }
}

function reseedPrelude(
  c: Parameters<typeof isValidEnronDemoReseedRequest>[0],
): Response | { dataRoot: string } {
  if (!enronDemoSecretConfigured()) {
    return c.json({ error: 'not_found' }, 404)
  }
  if (!isValidEnronDemoReseedRequest(c)) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  const dr = requireDataRoot(c)
  if (dr instanceof Response) return dr
  return { dataRoot: dr }
}

app.get('/enron/seed-status', async (c) => {
  const pre = bearerMintPrelude(c)
  if (pre instanceof Response) return pre

  const user = resolveDemoUserFromKey(c, c.req.query('demoUser') ?? undefined)
  if (user instanceof Response) return user

  const homeDir = tenantHomeDir(user.tenantUserId)
  const snap = getEnronDemoSeedSnapshot(homeDir, user.tenantUserId)
  c.header('Cache-Control', 'no-store, must-revalidate')
  return c.json({
    ok: true as const,
    demoUser: user.key,
    seed: snap,
  })
})

app.get('/enron/reseed', async (c) => {
  const pre = reseedPrelude(c)
  if (pre instanceof Response) return pre

  const user = resolveDemoUserFromKey(c, c.req.query('demoUser') ?? undefined)
  if (user instanceof Response) return user

  const { dataRoot } = pre
  const { tenantUserId } = user
  const homeDir = tenantHomeDir(tenantUserId)

  const started = startEnronDemoForceReseed(dataRoot, tenantUserId)
  if (started === 'busy') {
    return c.json(
      {
        ok: false as const,
        error: 'seed_already_running',
        message: 'Provisioning for this demo tenant is already in progress.',
        demoUser: user.key,
        seed: getEnronDemoSeedSnapshot(homeDir, tenantUserId),
      },
      409,
    )
  }

  c.header('Cache-Control', 'no-store, must-revalidate')
  return c.json(
    {
      ok: false as const,
      status: 'reseed' as const,
      demoUser: user.key,
      message:
        'Wiping and rebuilding this Enron demo tenant from the corpus tarball. Poll /api/auth/demo/enron/seed-status?demoUser=… until seed.status is ready, then sign in at /demo.',
      seed: getEnronDemoSeedSnapshot(homeDir, tenantUserId),
    },
    202,
  )
})

app.post('/enron', async (c) => {
  const mintGate = bearerMintPrelude(c)
  if (mintGate instanceof Response) return mintGate

  let bodyKey: string | undefined
  const ct = c.req.header('content-type') ?? ''
  if (ct.includes('application/json')) {
    try {
      const j = (await c.req.json()) as { demoUser?: unknown }
      if (typeof j.demoUser === 'string' && j.demoUser.trim()) bodyKey = j.demoUser
    } catch {
      /* empty body */
    }
  }

  const user = resolveDemoUserFromKey(c, bodyKey)
  if (user instanceof Response) return user

  const { tenantUserId } = user
  const homeDir = tenantHomeDir(tenantUserId)

  ensureProvisionedMarkerWhenMailReady(homeDir)

  if (!isEnronDemoTenantProvisioned(homeDir)) {
    const snap = getEnronDemoSeedSnapshot(homeDir, tenantUserId)
    return c.json(
      {
        error: 'demo_not_seeded' as const,
        demoUser: user.key,
        message: ENRON_DEMO_NOT_SEEDED_HINT,
        seed: snap,
      },
      503,
    )
  }

  await ensureEnronDemoHandleMetaFile(homeDir, tenantUserId, user.workspaceHandle)
  const meta = await readHandleMeta(homeDir)
  const workspaceHandle = meta?.handle ?? user.workspaceHandle

  const sessionId = await runWithTenantContextAsync(
    { tenantUserId, workspaceHandle, homeDir },
    async () => createVaultSession(),
  )
  await registerSessionTenant(sessionId, tenantUserId)
  setBrainSessionCookie(c, sessionId)

  return c.json({
    ok: true as const,
    demoUser: user.key,
    tenantUserId,
    workspaceHandle,
  })
})

export default app
