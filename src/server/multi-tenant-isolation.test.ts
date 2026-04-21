import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import wikiRoute from './routes/wiki.js'
import { tenantMiddleware } from './lib/tenantMiddleware.js'
import { ensureTenantHomeDir } from './lib/dataRoot.js'
import { registerSessionTenant } from './lib/tenantRegistry.js'
import { brainLayoutWikiDir } from './lib/brainLayout.js'

describe('multi-tenant isolation (Phase 3)', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  let dataRoot: string

  afterEach(() => {
    if (dataRoot) rmSync(dataRoot, { recursive: true, force: true })
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })

  function mountWikiOnly(): Hono {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.route('/api/wiki', wikiRoute)
    return app
  }

  it('lists wiki files only for the session tenant', async () => {
    dataRoot = join(tmpdir(), `mt-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = dataRoot
    mkdirSync(dataRoot, { recursive: true })

    const handleA = 'tenant-alpha'
    const handleB = 'tenant-beta'
    const homeA = ensureTenantHomeDir(handleA)
    const homeB = ensureTenantHomeDir(handleB)
    const wikiA = brainLayoutWikiDir(homeA)
    const wikiB = brainLayoutWikiDir(homeB)
    writeFileSync(join(wikiA, 'secret-a.md'), '# A only\n', 'utf-8')
    writeFileSync(join(wikiB, 'secret-b.md'), '# B only\n', 'utf-8')

    const sessA = 'session-for-tenant-a-uuid-001'
    const sessB = 'session-for-tenant-b-uuid-002'
    await registerSessionTenant(sessA, handleA)
    await registerSessionTenant(sessB, handleB)

    const app = mountWikiOnly()

    const ra = await app.request('http://localhost/api/wiki', {
      headers: { Cookie: `brain_session=${sessA}` },
    })
    expect(ra.status).toBe(200)
    const ja = (await ra.json()) as { path: string }[]
    expect(ja.some((x) => x.path.includes('secret-a'))).toBe(true)
    expect(ja.some((x) => x.path.includes('secret-b'))).toBe(false)

    const rb = await app.request('http://localhost/api/wiki', {
      headers: { Cookie: `brain_session=${sessB}` },
    })
    const jb = (await rb.json()) as { path: string }[]
    expect(jb.some((x) => x.path.includes('secret-b'))).toBe(true)
    expect(jb.some((x) => x.path.includes('secret-a'))).toBe(false)
  })

  it('wiki search does not leak other tenant matches', async () => {
    dataRoot = join(tmpdir(), `mt-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = dataRoot
    mkdirSync(dataRoot, { recursive: true })

    const handleA = 'tenant-gamma'
    const handleB = 'tenant-delta'
    const homeA = ensureTenantHomeDir(handleA)
    const homeB = ensureTenantHomeDir(handleB)
    writeFileSync(join(brainLayoutWikiDir(homeA), 'alpha.md'), 'unique-tenant-alpha-token\n', 'utf-8')
    writeFileSync(join(brainLayoutWikiDir(homeB), 'beta.md'), 'unique-tenant-beta-token\n', 'utf-8')

    const sessA = 'session-for-tenant-a-uuid-003'
    await registerSessionTenant(sessA, handleA)

    const app = mountWikiOnly()
    const res = await app.request(
      `http://localhost/api/wiki/search?q=${encodeURIComponent('unique-tenant-beta-token')}`,
      { headers: { Cookie: `brain_session=${sessA}` } },
    )
    expect(res.status).toBe(200)
    const paths = (await res.json()) as string[]
    expect(paths.length).toBe(0)
  })

  it('returns 401 tenant_required without session on protected wiki route', async () => {
    dataRoot = join(tmpdir(), `mt-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = dataRoot
    mkdirSync(dataRoot, { recursive: true })

    const app = mountWikiOnly()
    const res = await app.request('http://localhost/api/wiki')
    expect(res.status).toBe(401)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('tenant_required')
  })
})
