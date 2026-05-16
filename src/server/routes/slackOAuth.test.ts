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
})
