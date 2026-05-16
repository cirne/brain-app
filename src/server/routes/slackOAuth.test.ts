import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { clearSlackOAuthSessionsForTests, putSlackOAuthSession } from '@server/lib/platform/slackOAuthState.js'
import slackOAuthRoute from './slackOAuth.js'

describe('slack OAuth routes', () => {
  const prevId = process.env.SLACK_CLIENT_ID
  const prevSecret = process.env.SLACK_CLIENT_SECRET
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let dbPath: string

  beforeEach(async () => {
    process.env.SLACK_CLIENT_ID = 'test-client'
    process.env.SLACK_CLIENT_SECRET = 'test-secret'
    const dir = await mkdtemp(join(tmpdir(), 'slack-oauth-route-'))
    dbPath = join(dir, 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
    closeBrainGlobalDbForTests()
    clearSlackOAuthSessionsForTests()
  })

  afterEach(async () => {
    clearSlackOAuthSessionsForTests()
    closeBrainGlobalDbForTests()
    if (prevId === undefined) delete process.env.SLACK_CLIENT_ID
    else process.env.SLACK_CLIENT_ID = prevId
    if (prevSecret === undefined) delete process.env.SLACK_CLIENT_SECRET
    else process.env.SLACK_CLIENT_SECRET = prevSecret
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    await rm(join(dbPath, '..'), { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function app(): Hono {
    const a = new Hono()
    a.use('/api/*', tenantMiddleware)
    a.use('/api/*', vaultGateMiddleware)
    a.route('/api/slack/oauth', slackOAuthRoute)
    return a
  }

  it('callback rejects unknown state', async () => {
    const res = await app().request(
      'http://localhost/api/slack/oauth/callback?code=abc&state=unknown-state',
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('slackError')
  })

  it('link callback rejects when workspace not installed', async () => {
    const state = 'state-link-1'
    putSlackOAuthSession(state, 'usr_linker', 'link')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          team: { id: 'T_NO_INSTALL', name: 'X' },
          authed_user: { id: 'U1', access_token: 'xoxp-user' },
        }),
        { status: 200 },
      ),
    )
    const { registerSessionTenant } = await import('@server/lib/tenant/tenantRegistry.js')
    const { createVaultSession } = await import('@server/lib/vault/vaultSessionStore.js')
    const sid = await createVaultSession()
    await registerSessionTenant(sid, 'usr_linker')

    const res = await app().request(
      `http://localhost/api/slack/oauth/callback?code=abc&state=${state}`,
      { headers: { cookie: `brain_session=${sid}` } },
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('not%20connected%20to%20Braintunnel')
  })

  it('install callback persists workspace when session matches', async () => {
    const state = 'state-install-1'
    putSlackOAuthSession(state, 'usr_installer', 'install')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          access_token: 'xoxb-new',
          team: { id: 'T_INST', name: 'Gamaliel' },
        }),
        { status: 200 },
      ),
    )
    const { registerSessionTenant } = await import('@server/lib/tenant/tenantRegistry.js')
    const { createVaultSession } = await import('@server/lib/vault/vaultSessionStore.js')
    const sid = await createVaultSession()
    await registerSessionTenant(sid, 'usr_installer')

    const res = await app().request(
      `http://localhost/api/slack/oauth/callback?code=abc&state=${state}`,
      { headers: { cookie: `brain_session=${sid}` } },
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('slackConnected=1')
    const { getSlackWorkspace } = await import('@server/lib/slack/slackConnectionsRepo.js')
    expect(getSlackWorkspace('T_INST')?.bot_token).toBe('xoxb-new')
  })

  it('link callback with email mismatch redirects to confirm screen', async () => {
    const state = 'state-link-mismatch'
    putSlackOAuthSession(state, 'usr_linker2', 'link')

    const { upsertSlackWorkspace } = await import('@server/lib/slack/slackConnectionsRepo.js')
    upsertSlackWorkspace({
      slackTeamId: 'T_MISMATCH',
      teamName: 'Mismatch Corp',
      installerTenantUserId: 'usr_linker2',
      botToken: 'xoxb-m',
    })

    // Slack returns email that doesn't match tenant mailboxes (empty mailboxes)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.includes('oauth.v2.access')) {
        return new Response(
          JSON.stringify({
            ok: true,
            team: { id: 'T_MISMATCH', name: 'Mismatch Corp' },
            authed_user: { id: 'U_MM', access_token: 'xoxp-mm' },
          }),
          { status: 200 },
        )
      }
      // openid.connect.userInfo — return mismatched email
      return new Response(
        JSON.stringify({ ok: true, email: 'slack-user@other-domain.com' }),
        { status: 200 },
      )
    })

    const { registerSessionTenant } = await import('@server/lib/tenant/tenantRegistry.js')
    const { createVaultSession } = await import('@server/lib/vault/vaultSessionStore.js')
    const sid = await createVaultSession()
    await registerSessionTenant(sid, 'usr_linker2')

    const res = await app().request(
      `http://localhost/api/slack/oauth/callback?code=abc&state=${state}`,
      { headers: { cookie: `brain_session=${sid}` } },
    )
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('slackLinkConfirm=1')
    expect(location).toContain('slack-user%40other-domain.com')
    expect(location).toContain('confirmState=')
  })

  it('link-confirm route writes user link when state is valid', async () => {
    const { upsertSlackWorkspace, resolveLinkedTenant } = await import('@server/lib/slack/slackConnectionsRepo.js')
    upsertSlackWorkspace({
      slackTeamId: 'T_CONF',
      teamName: 'Confirm Corp',
      installerTenantUserId: 'usr_conf',
      botToken: 'xoxb-c',
    })

    const confirmState = 'conf-state-xyz'
    putSlackOAuthSession(confirmState, 'usr_conf', 'link-confirm')

    const { registerSessionTenant } = await import('@server/lib/tenant/tenantRegistry.js')
    const { createVaultSession } = await import('@server/lib/vault/vaultSessionStore.js')
    const sid = await createVaultSession()
    await registerSessionTenant(sid, 'usr_conf')

    const res = await app().request('http://localhost/api/slack/oauth/link-confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${sid}`,
      },
      body: JSON.stringify({
        confirmState,
        slackTeamId: 'T_CONF',
        slackUserId: 'U_CONF',
      }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean }
    expect(j.ok).toBe(true)
    // Link row should now exist
    expect(resolveLinkedTenant('T_CONF', 'U_CONF')?.tenant_user_id).toBe('usr_conf')
  })
})
