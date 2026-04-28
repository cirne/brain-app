import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import {
  appendDeviceAudit,
  listDeviceTokens,
  markDeviceTokenUsed,
  mintDeviceToken,
  parseDeviceTokenFromBearer,
  resolveDeviceToken,
  revokeDeviceToken,
} from './deviceTokenAuth.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'

let root: string
let prevBrainHome: string | undefined
let prevDataRoot: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'device-token-'))
  prevBrainHome = process.env.BRAIN_HOME
  prevDataRoot = process.env.BRAIN_DATA_ROOT
  delete process.env.BRAIN_DATA_ROOT
  process.env.BRAIN_HOME = root
})

afterEach(async () => {
  if (prevBrainHome == null) delete process.env.BRAIN_HOME
  else process.env.BRAIN_HOME = prevBrainHome
  if (prevDataRoot == null) delete process.env.BRAIN_DATA_ROOT
  else process.env.BRAIN_DATA_ROOT = prevDataRoot
  await rm(root, { recursive: true, force: true })
})

describe('deviceTokenAuth', () => {
  it('mints, lists, marks used, and revokes token', async () => {
    const minted = await mintDeviceToken({ label: 'MacBook Pro' })
    expect(minted.token.startsWith('brn_dev_')).toBe(true)
    const listed = await listDeviceTokens()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.label).toBe('MacBook Pro')
    expect(listed[0]?.lastUsedAt).toBeNull()
    await markDeviceTokenUsed(process.env.BRAIN_HOME!, listed[0]!.id, { batchCount: 2 })
    const listedAfterUse = await listDeviceTokens()
    expect(listedAfterUse[0]?.lastUsedAt).toBeTruthy()
    const removed = await revokeDeviceToken(listed[0]!.id)
    expect(removed).toBe(true)
    expect(await listDeviceTokens()).toHaveLength(0)
  })

  it('parses bearer token format', async () => {
    const minted = await mintDeviceToken({})
    const app = new Hono()
    app.get('/parse', (c) => c.json({ parsed: parseDeviceTokenFromBearer(c) }))
    const res = await app.request('http://localhost/parse', {
      headers: { Authorization: `Bearer ${minted.token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { parsed: { id: string; secret: string } | null }
    expect(body.parsed?.id).toBeTruthy()
    expect(body.parsed?.secret).toBeTruthy()
  })

  it('resolves in multi-tenant mode and keeps isolation', async () => {
    const tenantA = 'usr_aaaaaaaaaaaaaaaaaaaa'
    const tenantB = 'usr_bbbbbbbbbbbbbbbbbbbb'
    const mtRoot = await mkdtemp(join(tmpdir(), 'device-token-mt-'))
    delete process.env.BRAIN_HOME
    process.env.BRAIN_DATA_ROOT = mtRoot
    ensureTenantHomeDir(tenantA)
    ensureTenantHomeDir(tenantB)

    const tokenA = await runWithTenantContextAsync(
      { tenantUserId: tenantA, workspaceHandle: 'a', homeDir: tenantHomeDir(tenantA) },
      async () => (await mintDeviceToken({ label: 'A' })).token,
    )
    const tokenB = await runWithTenantContextAsync(
      { tenantUserId: tenantB, workspaceHandle: 'b', homeDir: tenantHomeDir(tenantB) },
      async () => (await mintDeviceToken({ label: 'B' })).token,
    )

    const resolvedA = await resolveDeviceToken(tokenA)
    const resolvedB = await resolveDeviceToken(tokenB)
    expect(resolvedA?.tenantUserId).toBe(tenantA)
    expect(resolvedB?.tenantUserId).toBe(tenantB)

    const tampered = tokenA.replace(/.$/, 'x')
    expect(await resolveDeviceToken(tampered)).toBeNull()

    await rm(mtRoot, { recursive: true, force: true })
  })

  it('writes audit rows for mint/use/revoke/wipe actions', async () => {
    const minted = await mintDeviceToken({ label: 'Audit Mac' })
    const listed = await listDeviceTokens()
    const id = listed[0]!.id
    await markDeviceTokenUsed(process.env.BRAIN_HOME!, id, { batchCount: 3 })
    await revokeDeviceToken(id)
    await appendDeviceAudit(process.env.BRAIN_HOME!, { action: 'wipe', batchCount: 7 })

    const filePath = join(process.env.BRAIN_HOME!, 'var', 'devices.json')
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as { audit?: Array<{ action: string }> }
    const actions = (parsed.audit ?? []).map((a) => a.action)
    expect(actions).toContain('mint')
    expect(actions).toContain('used')
    expect(actions).toContain('revoke')
    expect(actions).toContain('wipe')
    expect(minted.token.startsWith('brn_dev_')).toBe(true)
  })

  it('stores only hashed token material (no plaintext secret)', async () => {
    const minted = await mintDeviceToken({ label: 'Hash Check' })
    const secret = minted.token.split('.')[1] ?? ''
    expect(secret.length).toBeGreaterThan(0)
    const raw = await readFile(join(process.env.BRAIN_HOME!, 'var', 'devices.json'), 'utf-8')
    expect(raw).not.toContain(minted.token)
    expect(raw).not.toContain(secret)
  })
})
