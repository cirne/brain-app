import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@server/lib/auth/enronDemoSeed.js', () => ({
  ensureProvisionedMarkerWhenMailReady: vi.fn(),
  isEnronDemoTenantProvisioned: vi.fn(() => false),
  getEnronDemoSeedSnapshot: vi.fn(() => ({
    status: 'running' as const,
    phase: 'downloading' as const,
    startedAt: 1,
  })),
  startEnronDemoSeedIfNeeded: vi.fn(),
  startEnronDemoForceReseed: vi.fn(),
}))

import { Hono } from 'hono'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import demoEnronAuthRoute from './demoEnronAuth.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'
import * as seed from '@server/lib/auth/enronDemoSeed.js'

const DEMO_SECRET = 'test-demo-secret-16chars'

describe('POST /api/auth/demo/enron lazy seed (mocked)', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevHome = process.env.BRAIN_HOME
  const prevSecret = process.env.BRAIN_ENRON_DEMO_SECRET

  let mtRoot: string

  beforeEach(async () => {
    vi.clearAllMocks()
    delete process.env.BRAIN_HOME
    mtRoot = await mkdtemp(join(tmpdir(), 'demo-enron-lazy-'))
    process.env.BRAIN_DATA_ROOT = mtRoot
    process.env.BRAIN_ENRON_DEMO_SECRET = DEMO_SECRET

    ensureTenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    const home = tenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    await writeHandleMeta(home, {
      userId: ENRON_DEMO_TENANT_USER_ID_DEFAULT,
      handle: 'enron-fixture',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await mkdir(join(home, 'ripmail'), { recursive: true })
    await writeFile(join(home, 'ripmail', 'ripmail.db'), '', 'utf8')
  })

  afterEach(async () => {
    await rm(mtRoot, { recursive: true, force: true })
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
    if (prevHome === undefined) delete process.env.BRAIN_HOME
    else process.env.BRAIN_HOME = prevHome
    if (prevSecret === undefined) delete process.env.BRAIN_ENRON_DEMO_SECRET
    else process.env.BRAIN_ENRON_DEMO_SECRET = prevSecret
  })

  function mountStack() {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/auth/demo', demoEnronAuthRoute)
    return app
  }

  it('returns 202 and kicks background seed when ripmail is not ready', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DEMO_SECRET}` },
    })
    expect(res.status).toBe(202)
    const j = (await res.json()) as { status?: string }
    expect(j.status).toBe('seeding')
    expect(seed.startEnronDemoSeedIfNeeded).toHaveBeenCalled()
  })
})
