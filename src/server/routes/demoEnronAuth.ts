import { Hono } from 'hono'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta, isValidUserId } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { setBrainSessionCookie } from '@server/lib/vault/vaultCookie.js'
import {
  enronDemoTenantUserId,
  ensureEnronDemoHandleMetaFile,
  isValidEnronDemoBearer,
  isValidEnronDemoReseedRequest,
  enronDemoSecretConfigured,
} from '@server/lib/auth/enronDemo.js'
import {
  ensureProvisionedMarkerWhenMailReady,
  getEnronDemoSeedSnapshot,
  isEnronDemoTenantProvisioned,
  startEnronDemoForceReseed,
  startEnronDemoSeedIfNeeded,
} from '@server/lib/auth/enronDemoSeed.js'

const app = new Hono()

function demoPrelude(
  c: Parameters<typeof isValidEnronDemoBearer>[0],
  auth: 'mint' | 'reseed',
): Response | { tenantUserId: string; homeDir: string; dataRoot: string } {
  if (!enronDemoSecretConfigured()) {
    return c.json({ error: 'not_found' }, 404)
  }

  const authOk = auth === 'reseed' ? isValidEnronDemoReseedRequest(c) : isValidEnronDemoBearer(c)
  if (!authOk) {
    return c.json({ error: 'unauthorized' }, 401)
  }

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

  const tenantUserId = enronDemoTenantUserId()
  if (!isValidUserId(tenantUserId)) {
    return c.json(
      {
        error: 'server_misconfigured',
        message: 'BRAIN_ENRON_DEMO_TENANT_ID must be usr_ plus 20 lowercase alphanumerics.',
      },
      503,
    )
  }

  const homeDir = tenantHomeDir(tenantUserId)
  return { tenantUserId, homeDir, dataRoot }
}

app.get('/enron/seed-status', async (c) => {
  const pre = demoPrelude(c, 'mint')
  if (pre instanceof Response) return pre

  const snap = getEnronDemoSeedSnapshot(pre.homeDir)
  c.header('Cache-Control', 'no-store, must-revalidate')
  return c.json({ ok: true as const, seed: snap })
})

app.get('/enron/reseed', async (c) => {
  const pre = demoPrelude(c, 'reseed')
  if (pre instanceof Response) return pre

  const { tenantUserId, homeDir, dataRoot } = pre
  const started = startEnronDemoForceReseed(dataRoot, tenantUserId)
  if (started === 'busy') {
    return c.json(
      {
        ok: false as const,
        error: 'seed_already_running',
        message: 'Demo provisioning is already in progress.',
        seed: getEnronDemoSeedSnapshot(homeDir),
      },
      409,
    )
  }

  c.header('Cache-Control', 'no-store, must-revalidate')
  return c.json(
    {
      ok: false as const,
      status: 'reseed' as const,
      message:
        'Wiping and rebuilding the Enron demo tenant from the corpus tarball. Poll /api/auth/demo/enron/seed-status until seed.status is ready, then sign in at /demo.',
      seed: getEnronDemoSeedSnapshot(homeDir),
    },
    202,
  )
})

app.post('/enron', async (c) => {
  const pre = demoPrelude(c, 'mint')
  if (pre instanceof Response) return pre

  const { tenantUserId, homeDir, dataRoot } = pre

  ensureProvisionedMarkerWhenMailReady(homeDir)

  if (!isEnronDemoTenantProvisioned(homeDir)) {
    startEnronDemoSeedIfNeeded(dataRoot, tenantUserId)
    const snap = getEnronDemoSeedSnapshot(homeDir)
    if (snap.status !== 'ready') {
      return c.json(
        {
          ok: false as const,
          status: 'seeding' as const,
          message:
            'Provisioning the Enron demo mailbox (first visit can take 15–40+ minutes). This page refreshes status every few seconds.',
          seed: snap,
        },
        202,
      )
    }
  }

  await ensureEnronDemoHandleMetaFile(homeDir, tenantUserId, 'enron-demo')
  const meta = await readHandleMeta(homeDir)
  const workspaceHandle = meta?.handle ?? 'enron-demo'

  const sessionId = await runWithTenantContextAsync(
    { tenantUserId, workspaceHandle, homeDir },
    async () => createVaultSession(),
  )
  await registerSessionTenant(sessionId, tenantUserId)
  setBrainSessionCookie(c, sessionId)

  return c.json({
    ok: true as const,
    tenantUserId,
    workspaceHandle,
  })
})

export default app
