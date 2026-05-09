import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { readFile, mkdir, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import demoEnronAuthRoute, { ENRON_DEMO_NOT_SEEDED_HINT } from './demoEnronAuth.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { writeHandleMeta, readHandleMeta, HANDLE_META_FILENAME } from '@server/lib/tenant/handleMeta.js'
import {
  ENRON_DEMO_RESEED_PATH,
  ENRON_DEMO_TENANT_USER_ID_DEFAULT,
  ENRON_DEMO_USERS_PATH,
} from '@server/lib/auth/enronDemo.js'
import { ENRON_DEMO_PROVISIONED_FILENAME } from '@server/lib/auth/enronDemoSeed.js'
import * as enronDemoSeed from '@server/lib/auth/enronDemoSeed.js'

const DEMO_SECRET = 'test-demo-secret-16chars'

/** Kenneth Lay demo tenant (registry). */
const LAY_TENANT_ID = 'usr_enrondemo00000000002'

function mintHeaders(secret: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  }
}

function cookieSessionId(res: Response): string | undefined {
  const raw = res.headers.get('set-cookie') ?? ''
  const m = raw.match(/brain_session=([^;]+)/)
  return m?.[1]
}

describe('GET /api/auth/demo/enron/users', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevSecret = process.env.BRAIN_ENRON_DEMO_SECRET

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
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

  it('returns 404 when demo secret is not configured', async () => {
    delete process.env.BRAIN_ENRON_DEMO_SECRET
    const app = mountStack()
    const res = await app.request(`http://127.0.0.1${ENRON_DEMO_USERS_PATH}`)
    expect(res.status).toBe(404)
  })

  it('returns user keys and labels without Bearer', async () => {
    process.env.BRAIN_ENRON_DEMO_SECRET = DEMO_SECRET
    const app = mountStack()
    const res = await app.request(`http://127.0.0.1${ENRON_DEMO_USERS_PATH}`)
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      ok?: boolean
      users?: Array<{ key: string; label: string }>
    }
    expect(j.ok).toBe(true)
    expect(j.users?.map(u => u.key).sort()).toEqual(['kean', 'lay', 'skilling'])
    expect(j.users?.every(u => typeof u.label === 'string' && u.label.length > 0)).toBe(true)
  })
})

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
      headers: mintHeaders('x'),
      body: JSON.stringify({ demoUser: 'kean' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 401 without bearer', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ demoUser: 'kean' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for wrong bearer', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders('wrong-secret-16ch'),
      body: JSON.stringify({ demoUser: 'kean' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for unknown demoUser', async () => {
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders(DEMO_SECRET),
      body: JSON.stringify({ demoUser: 'not-a-user' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 503 demo_not_seeded when tenant mail is not provisioned', async () => {
    const home = tenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    await writeFile(join(home, 'ripmail', 'ripmail.db'), '', 'utf8')

    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders(DEMO_SECRET),
      body: JSON.stringify({ demoUser: 'kean' }),
    })
    expect(res.status).toBe(503)
    const j = (await res.json()) as {
      error?: string
      message?: string
      demoUser?: string
      seed?: { status?: string }
    }
    expect(j.error).toBe('demo_not_seeded')
    expect(j.demoUser).toBe('kean')
    expect(j.message).toBe(ENRON_DEMO_NOT_SEEDED_HINT)
    expect(j.seed?.status).toBe('idle')
  })

  it('mints session when secret is short but non-empty and bearer matches', async () => {
    process.env.BRAIN_ENRON_DEMO_SECRET = 'tooshort'
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders('tooshort'),
      body: JSON.stringify({ demoUser: 'kean' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean; tenantUserId?: string; demoUser?: string }
    expect(j.ok).toBe(true)
    expect(j.demoUser).toBe('kean')
    expect(j.tenantUserId).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
  })

  it('defaults demoUser to kean when JSON body omitted', async () => {
    process.env.BRAIN_ENRON_DEMO_SECRET = 'tooshort'
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders('tooshort'),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { demoUser?: string; tenantUserId?: string }
    expect(j.demoUser).toBe('kean')
    expect(j.tenantUserId).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
  })

  it('returns 503 when BRAIN_ENRON_DEMO_TENANT_ID does not match selected demo user', async () => {
    process.env.BRAIN_ENRON_DEMO_TENANT_ID = ENRON_DEMO_TENANT_USER_ID_DEFAULT
    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders(DEMO_SECRET),
      body: JSON.stringify({ demoUser: 'lay' }),
    })
    expect(res.status).toBe(503)
  })

  it('GET seed-status returns seed snapshot when bearer is valid', async () => {
    const app = mountStack()
    const res = await app.request(
      `http://127.0.0.1/api/auth/demo/enron/seed-status?demoUser=kean`,
      {
        headers: { Authorization: `Bearer ${DEMO_SECRET}` },
      },
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      ok?: boolean
      demoUser?: string
      seed?: { status?: string }
    }
    expect(j.ok).toBe(true)
    expect(j.demoUser).toBe('kean')
    expect(j.seed?.status).toBe('ready')
  })

  it('writes handle-meta when missing but ripmail.db is ready', async () => {
    const home = tenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    await unlink(join(home, HANDLE_META_FILENAME)).catch(() => {})

    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders(DEMO_SECRET),
      body: JSON.stringify({ demoUser: 'kean' }),
    })
    expect(res.status).toBe(200)
    const meta = await readHandleMeta(home)
    expect(meta?.userId).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    expect(meta?.handle).toBe('demo-steve-kean')
    expect(meta?.confirmedAt).toBeNull()
  })

  it('mints session and sets cookie when bearer and layout are valid', async () => {
    const app = mountStack()
    const home = tenantHomeDir(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders(DEMO_SECRET),
      body: JSON.stringify({ demoUser: 'kean' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      ok?: boolean
      tenantUserId?: string
      workspaceHandle?: string
      demoUser?: string
    }
    expect(j.ok).toBe(true)
    expect(j.demoUser).toBe('kean')
    expect(j.tenantUserId).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)
    expect(j.workspaceHandle).toBe('enron-fixture')
    const sid = cookieSessionId(res)
    expect(sid).toBeTruthy()

    const regRaw = await readFile(join(mtRoot, '.global', 'tenant-registry.json'), 'utf8')
    const reg = JSON.parse(regRaw) as { sessions?: Record<string, string> }
    expect(reg.sessions?.[sid!]).toBe(ENRON_DEMO_TENANT_USER_ID_DEFAULT)

    const markerRaw = await readFile(join(home, ENRON_DEMO_PROVISIONED_FILENAME), 'utf8')
    expect(JSON.parse(markerRaw) as { provisionedAt?: string }).toMatchObject({
      provisionedAt: expect.any(String),
    })
  })

  it('mints Lay tenant when demoUser is lay', async () => {
    ensureTenantHomeDir(LAY_TENANT_ID)
    const layHome = tenantHomeDir(LAY_TENANT_ID)
    await writeHandleMeta(layHome, {
      userId: LAY_TENANT_ID,
      handle: 'demo-ken-lay',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    await mkdir(join(layHome, 'ripmail'), { recursive: true })
    await writeFile(join(layHome, 'ripmail', 'ripmail.db'), 'fixture', 'utf8')

    const app = mountStack()
    const res = await app.request('http://127.0.0.1/api/auth/demo/enron', {
      method: 'POST',
      headers: mintHeaders(DEMO_SECRET),
      body: JSON.stringify({ demoUser: 'lay' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { tenantUserId?: string; demoUser?: string }
    expect(j.demoUser).toBe('lay')
    expect(j.tenantUserId).toBe(LAY_TENANT_ID)
  })
})

describe('GET /api/auth/demo/enron/reseed', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevHome = process.env.BRAIN_HOME
  const prevSecret = process.env.BRAIN_ENRON_DEMO_SECRET
  const prevTenantId = process.env.BRAIN_ENRON_DEMO_TENANT_ID

  let mtRoot: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    delete process.env.BRAIN_HOME
    mtRoot = await mkdtemp(join(tmpdir(), 'demo-enron-reseed-'))
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

  it('returns 202 with Bearer and kicks force reseed', async () => {
    const spy = vi.spyOn(enronDemoSeed, 'startEnronDemoForceReseed').mockReturnValue('started')
    const app = mountStack()
    const res = await app.request(
      `http://127.0.0.1${ENRON_DEMO_RESEED_PATH}?demoUser=kean`,
      {
        headers: { Authorization: `Bearer ${DEMO_SECRET}` },
      },
    )
    expect(res.status).toBe(202)
    const j = (await res.json()) as { status?: string; seed?: { status?: string }; demoUser?: string }
    expect(j.status).toBe('reseed')
    expect(j.demoUser).toBe('kean')
    expect(j.seed?.status).toBe('ready')
    expect(spy).toHaveBeenCalledWith(mtRoot, ENRON_DEMO_TENANT_USER_ID_DEFAULT)
  })

  it('accepts demo secret via query param (no Authorization header)', async () => {
    const spy = vi.spyOn(enronDemoSeed, 'startEnronDemoForceReseed').mockReturnValue('started')
    const app = mountStack()
    const url = `http://127.0.0.1${ENRON_DEMO_RESEED_PATH}?demoUser=kean&secret=${encodeURIComponent(DEMO_SECRET)}`
    const res = await app.request(url)
    expect(res.status).toBe(202)
    expect(spy).toHaveBeenCalled()
  })

  it('returns 401 when query secret is wrong', async () => {
    const spy = vi.spyOn(enronDemoSeed, 'startEnronDemoForceReseed')
    const app = mountStack()
    const url = `http://127.0.0.1${ENRON_DEMO_RESEED_PATH}?demoUser=kean&secret=${encodeURIComponent('wrong-secret-16ch')}`
    const res = await app.request(url)
    expect(res.status).toBe(401)
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns 409 when force reseed reports busy for the same tenant', async () => {
    const spy = vi
      .spyOn(enronDemoSeed, 'startEnronDemoForceReseed')
      .mockReturnValueOnce('started')
      .mockReturnValueOnce('busy')
    const app = mountStack()
    const h = { Authorization: `Bearer ${DEMO_SECRET}` }
    const url = `http://127.0.0.1${ENRON_DEMO_RESEED_PATH}?demoUser=kean`
    const res1 = await app.request(url, { headers: h })
    const res2 = await app.request(url, { headers: h })
    expect(res1.status).toBe(202)
    expect(res2.status).toBe(409)
    const j2 = (await res2.json()) as { error?: string }
    expect(j2.error).toBe('seed_already_running')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
