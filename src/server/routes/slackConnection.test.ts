import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import slackConnectionRoute from './slackConnection.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { upsertSlackWorkspace } from '@server/lib/slack/slackConnectionsRepo.js'

const prevRoot = process.env.BRAIN_DATA_ROOT
const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

function mountApp(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/slack', slackConnectionRoute)
  return app
}

describe('/api/slack connection settings', () => {
  let root: string
  let globalSqlite: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slack-conn-api-'))
    globalSqlite = join(root, 'brain-global.sqlite')
    process.env.BRAIN_DATA_ROOT = root
    process.env.BRAIN_GLOBAL_SQLITE_PATH = globalSqlite
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    await rm(root, { recursive: true, force: true })
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    else delete process.env.BRAIN_DATA_ROOT
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
  })

  async function vaultCookieFor(handle: string): Promise<string> {
    ensureTenantHomeDir(handle)
    const sid = await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, handle)
    return sid
  }

  it('GET settings without session returns 401', async () => {
    const handle = 'usr_slackset00000000001'
    ensureTenantHomeDir(handle)
    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'W',
      installerTenantUserId: handle,
      botToken: 'x',
    })
    const app = mountApp()
    const res = await app.request('http://localhost/api/slack/connection/T001/settings')
    expect(res.status).toBe(401)
  })

  it('GET settings returns defaults when linked via installer', async () => {
    const handle = 'usr_slackset00000000002'
    const sid = await vaultCookieFor(handle)
    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'Gamaliel',
      installerTenantUserId: handle,
      botToken: 'x',
    })

    const app = mountApp()
    const res = await app.request('http://localhost/api/slack/connection/T001/settings', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      autorespond: false,
      inboundPolicy: 'general',
    })
  })

  it('PATCH merges and GET returns updated values', async () => {
    const handle = 'usr_slackset00000000003'
    const sid = await vaultCookieFor(handle)
    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'Gamaliel',
      installerTenantUserId: handle,
      botToken: 'x',
    })

    const app = mountApp()
    const patch = await app.request('http://localhost/api/slack/connection/T001/settings', {
      method: 'PATCH',
      headers: {
        Cookie: `brain_session=${sid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ autorespond: true, inboundPolicy: 'trusted' }),
    })
    expect(patch.status).toBe(200)
    expect(await patch.json()).toEqual({
      ok: true,
      autorespond: true,
      inboundPolicy: 'trusted',
    })

    const get = await app.request('http://localhost/api/slack/connection/T001/settings', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(get.status).toBe(200)
    expect(await get.json()).toMatchObject({
      ok: true,
      autorespond: true,
      inboundPolicy: 'trusted',
    })
  })

  it('PATCH rejects invalid inboundPolicy', async () => {
    const handle = 'usr_slackset00000000004'
    const sid = await vaultCookieFor(handle)
    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'Gamaliel',
      installerTenantUserId: handle,
      botToken: 'x',
    })

    const app = mountApp()
    const res = await app.request('http://localhost/api/slack/connection/T001/settings', {
      method: 'PATCH',
      headers: {
        Cookie: `brain_session=${sid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inboundPolicy: 'nope' }),
    })
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('inbound_policy_invalid')
  })

  it('GET settings returns 403 when tenant has no workspace access', async () => {
    const installer = 'usr_slackset00000000005'
    const other = 'usr_slackset00000000006'
    const sidOther = await vaultCookieFor(other)

    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'Gamaliel',
      installerTenantUserId: installer,
      botToken: 'x',
    })

    const app = mountApp()
    const res = await app.request('http://localhost/api/slack/connection/T001/settings', {
      headers: { Cookie: `brain_session=${sidOther}` },
    })
    expect(res.status).toBe(403)
  })
})
