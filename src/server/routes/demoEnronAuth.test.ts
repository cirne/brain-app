import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { readFile, mkdir, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import demoEnronAuthRoute from './demoEnronAuth.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { writeHandleMeta, readHandleMeta, HANDLE_META_FILENAME } from '@server/lib/tenant/handleMeta.js'
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'

const DEMO_SECRET = 'test-demo-secret-16chars'

function cookieSessionId(res: Response): string | undefined {
  const raw = res.headers.get('set-cookie') ?? ''
  const m = raw.match(/brain_session=([^;]+)/)
  return m?.[1]
}

describe('POST /api/auth/demo/enron', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevHome = process.env.BRAIN_HOME
  const prevSecret = process.env.BRAIN_ENRON_DEMO_SECRET
  const prevTenantId = process.env.BRAIN_ENRON_DEMO_TENANT_ID

  let mtRoot: string

  beforeEach(async () => {
    delete process.env.BRAIN_HOME
    mtRoot = await mkdtemp(join(tmpdir(), 'demo-enron-mt-'))
    process.env.BRAIN_DATA_ROOT = mtRoot
    process.env.BRAIN_ENRON_DEMO_SECRET = DEMO_SECRET
    delete process.env.BRAIN_ENRON_DEMO_TENANT_ID

    ensureTenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    const home = tenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    await writeHandleMeta(home, {
      userId: ENRON_DEMO_TENANT_USER_ID_DEFAULT,
      handle: 'enron-fixture',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await mkdir(join(home, 'ripmail'), { recursive: true })
    await writeFile(join(home, 'ripmail', 'ripmail.db'), 'fixture', 'utf8')
  })

  afterEach(async () => {
    await rm(mtRoot, { recursive: true, force: true })
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
    if (prevHome === undefined) delete process.env.BRAIN_HOME
    else process.env.BRAIN_HOME = prevHome
    if (prevSecret === undefined) delete process.env.BRAIN_ENRON_DEMO_SECRET
    else process.env.BRAIN_ENRON_DEMO_SECRET = prevSecret
    if (prevTenantId === undefined) delete process.env.BRAIN_ENRON_DEMO_TENANT_ID
    else process.env.BRAIN_ENRON_DEMO_TENANT_ID = prevTenantId
  })

  function mountStack() {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/auth/demo', demoEnronAuthRoute)
    return app
  }

  it('returns 404 when BRAIN_ENRON_DEMO_SECRET is not configured', async () => {
    delete process.env.BRAIN_ENRON_DEMO_SECRET
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 without bearer', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 401 for wrong bearer', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret-16ch' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 when secret is too short (not configured)', async () => {
    process.env.BRAIN_ENRON_DEMO_SECRET = 'tooshort'
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: 'Bearer tooshort' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 503 for invalid BRAIN_ENRON_DEMO_TENANT_ID override', async () => {
    process.env.BRAIN_ENRON_DEMO_TENANT_ID = 'not-a-valid-id'
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DEMO_SECRET}` },
    })
    expect(res.status).toBe(503)
  })

  it('GET seed-status returns seed snapshot when bearer is valid', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron/seed-status', {
      headers: { Authorization: `Bearer ${DEMO_SECRET}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean; seed?: { status?: string } }
    expect(j.ok).toBe(true)
    expect(j.seed?.status).toBe('ready')
  })

  it('writes handle-meta when missing but ripmail.db is ready', async () => {
    const home = tenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    await unlink(join(home, HANDLE_META_FILENAME)).catch(() => {})

    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DEMO_SECRET}` },
    })
    expect(res.status).toBe(200)
    const meta = await readHandleMeta(home)
    expect(meta?.userId).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    expect(meta?.handle).toBe('enron-demo')
    expect(meta?.confirmedAt).toBeNull()
  })

  it('mints session and sets cookie when bearer and layout are valid', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DEMO_SECRET}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean; tenantUserId?: string; workspaceHandle?: string }
    expect(j.ok).toBe(true)
    expect(j.tenantUserId).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    expect(j.workspaceHandle).toBe('enron-fixture')
    const sid = cookieSessionId(res)
    expect(sid).toBeTruthy()

    const regRaw = await readFile(join(mtRoot, '.global', 'tenant-registry.json'), 'utf8')
    const reg = JSON.parse(regRaw) as { sessions?: Record<string, string> }
    expect(reg.sessions?.[sid!]).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
  })

  it('returns 501 in single-tenant mode', async () => {
    delete process.env.BRAIN_DATA_ROOT
    process.env.BRAIN_HOME = await mkdtemp(join(tmpdir(), 'demo-enron-st-'))
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DEMO_SECRET}` },
    })
    expect(res.status).toBe(501)
    await rm(process.env.BRAIN_HOME, { recursive: true, force: true })
    delete process.env.BRAIN_HOME
  })
})
