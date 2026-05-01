import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'
import accountRoute from './account.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { brainLayoutRipmailDir } from '@server/lib/platform/brainLayout.js'
import { deriveWorkspaceHandleSeed } from '@server/lib/tenant/googleIdentityWorkspace.js'
import {
  registerIdentityWorkspace,
  registerSessionTenant,
} from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { generateUserId, writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { googleIdentityKey } from '@server/lib/tenant/googleIdentityWorkspace.js'

describe('/api/account routes', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT

  beforeEach(() => {
    delete process.env.BRAIN_HOME
  })

  afterEach(async () => {
    delete process.env.BRAIN_DATA_ROOT
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
  })

  function mountAccount(): Hono {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/account', accountRoute)
    return app
  }

  it('GET /handle returns userId and unconfirmed meta', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acct-get-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'acct-handle-one'
    const key = googleIdentityKey('sub-acct')
    const uid = generateUserId()
    ensureTenantHomeDir(uid)
    await registerIdentityWorkspace(key, uid)
    await writeHandleMeta(tenantHomeDir(uid), {
      userId: uid,
      handle,
      confirmedAt: null,
    })

    const sid = await runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: handle, homeDir: tenantHomeDir(uid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, uid)

    const app = mountAccount()
    const res = await app.request('http://localhost/api/account/handle', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      userId: string
      handle: string
      confirmedAt: string | null
      suggestedHandle: string
    }
    expect(j.userId).toBe(uid)
    expect(j.handle).toBe(handle)
    expect(j.confirmedAt).toBeNull()
    expect(j.suggestedHandle).toBe(deriveWorkspaceHandleSeed('', 'sub-acct'))

    await rm(root, { recursive: true, force: true })
  })

  it('GET /handle suggests email local-part when handle is still the tenant user id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acct-sug-'))
    process.env.BRAIN_DATA_ROOT = root

    const key = googleIdentityKey('sub-suggest')
    const uid = generateUserId()
    ensureTenantHomeDir(uid)
    await registerIdentityWorkspace(key, uid)
    await writeHandleMeta(tenantHomeDir(uid), {
      userId: uid,
      handle: uid,
      confirmedAt: null,
    })

    const rip = brainLayoutRipmailDir(tenantHomeDir(uid))
    await mkdir(rip, { recursive: true })
    await writeFile(
      join(rip, 'config.json'),
      JSON.stringify(
        {
          sources: [
            {
              id: 'mbx',
              kind: 'imap',
              email: 'very.alpha@example.com',
              imap: { host: 'imap.gmail.com', port: 993 },
              imapAuth: 'googleOAuth',
            },
          ],
        },
        null,
        2,
      ) + '\n',
    )

    const sid = await runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: uid, homeDir: tenantHomeDir(uid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, uid)

    const app = mountAccount()
    const res = await app.request('http://localhost/api/account/handle', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { handle: string; suggestedHandle: string }
    expect(j.handle).toBe(uid)
    expect(j.suggestedHandle).toBe(deriveWorkspaceHandleSeed('very.alpha@example.com', 'sub-suggest'))

    await rm(root, { recursive: true, force: true })
  })

  it('GET /handle/check succeeds without Google identity (e.g. Enron demo session)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acct-check-demo-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'enron-demo'
    const uid = generateUserId()
    ensureTenantHomeDir(uid)
    await writeHandleMeta(tenantHomeDir(uid), {
      userId: uid,
      handle,
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })

    const sid = await runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: handle, homeDir: tenantHomeDir(uid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, uid)

    const app = mountAccount()
    const res = await app.request(
      `http://localhost/api/account/handle/check?handle=${encodeURIComponent('enron')}`,
      { headers: { Cookie: `brain_session=${sid}` } },
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { available?: boolean }
    expect(j.available).toBe(true)

    await rm(root, { recursive: true, force: true })
  })

  it('GET /workspace-handles requires a tenant session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acct-wh-noauth-'))
    process.env.BRAIN_DATA_ROOT = root

    const app = mountAccount()
    const res = await app.request('http://localhost/api/account/workspace-handles?q=cir')
    expect(res.status).toBe(401)

    await rm(root, { recursive: true, force: true })
  })

  it('GET /workspace-handles returns confirmed handles with name + primary email, excluding caller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acct-wh-ok-'))
    process.env.BRAIN_DATA_ROOT = root

    const callerUid = generateUserId()
    ensureTenantHomeDir(callerUid)
    await writeHandleMeta(tenantHomeDir(callerUid), {
      userId: callerUid,
      handle: 'caller',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })

    const peerUid = generateUserId()
    ensureTenantHomeDir(peerUid)
    await writeHandleMeta(tenantHomeDir(peerUid), {
      userId: peerUid,
      handle: 'cirne',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      displayName: 'Lewis Cirne',
    })
    const peerVar = brainLayoutVarDir(tenantHomeDir(peerUid))
    await mkdir(peerVar, { recursive: true })
    await writeFile(
      join(peerVar, 'linked-mailboxes.json'),
      JSON.stringify({
        v: 1,
        mailboxes: [
          { email: 'cirne@example.com', googleSub: 'sub-cirne', linkedAt: '2026-01-01T00:00:00.000Z', isPrimary: true },
        ],
      }),
    )

    const sid = await runWithTenantContextAsync(
      { tenantUserId: callerUid, workspaceHandle: 'caller', homeDir: tenantHomeDir(callerUid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, callerUid)

    const app = mountAccount()
    const res = await app.request('http://localhost/api/account/workspace-handles?q=cir', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      results: Array<{ userId: string; handle: string; displayName?: string; primaryEmail: string | null }>
    }
    expect(j.results).toHaveLength(1)
    expect(j.results[0]).toMatchObject({
      userId: peerUid,
      handle: 'cirne',
      displayName: 'Lewis Cirne',
      primaryEmail: 'cirne@example.com',
    })

    const callerInResults = j.results.find((r) => r.userId === callerUid)
    expect(callerInResults).toBeUndefined()

    await rm(root, { recursive: true, force: true })
  })

  it('POST /handle/confirm sets confirmedAt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acct-confirm-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'confirm-handle-z'
    const key = googleIdentityKey('sub-confirm')
    const uid = generateUserId()
    ensureTenantHomeDir(uid)
    await registerIdentityWorkspace(key, uid)
    await writeHandleMeta(tenantHomeDir(uid), {
      userId: uid,
      handle,
      confirmedAt: null,
    })

    const sid = await runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: handle, homeDir: tenantHomeDir(uid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, uid)

    const app = mountAccount()
    const post = await app.request('http://localhost/api/account/handle/confirm', {
      method: 'POST',
      headers: {
        Cookie: `brain_session=${sid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ handle }),
    })
    expect(post.status).toBe(200)

    const get = await app.request('http://localhost/api/account/handle', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    const j = (await get.json()) as { confirmedAt: string | null }
    expect(j.confirmedAt).toBeTruthy()

    await rm(root, { recursive: true, force: true })
  })
})
