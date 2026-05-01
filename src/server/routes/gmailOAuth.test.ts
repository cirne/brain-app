import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import gmailOAuthRoute from './gmailOAuth.js'
import {
  clearGmailOAuthSessionsForTests,
  putOAuthSession,
} from '@server/lib/platform/gmailOAuthState.js'
import { clearGoogleOauthDesktopResultForTests } from '@server/lib/platform/googleOauthDesktopResult.js'
import { googleOAuthRedirectUri } from '@server/lib/platform/brainHttpPort.js'
import {
  generatePkce,
  GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
} from '@server/lib/platform/googleOAuth.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { brainLayoutChatsDir } from '@server/lib/platform/brainLayout.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { generateUserId, writeHandleMeta } from '@server/lib/tenant/handleMeta.js'

let brainHome: string
let savedRipmailHome: string | undefined

beforeEach(async () => {
  savedRipmailHome = process.env.RIPMAIL_HOME
  delete process.env.RIPMAIL_HOME
  brainHome = await mkdtemp(join(tmpdir(), 'gmail-oauth-route-'))
  process.env.BRAIN_DATA_ROOT = brainHome
  delete process.env.BRAIN_HOME
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret'
  clearGmailOAuthSessionsForTests()
  clearGoogleOauthDesktopResultForTests()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_DATA_ROOT
  delete process.env.BRAIN_HOME
  delete process.env.GOOGLE_OAUTH_CLIENT_ID
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (savedRipmailHome !== undefined) {
    process.env.RIPMAIL_HOME = savedRipmailHome
  } else {
    delete process.env.RIPMAIL_HOME
  }
  clearGmailOAuthSessionsForTests()
  clearGoogleOauthDesktopResultForTests()
})

function mountApp() {
  const app = new Hono()
  app.route('/api/oauth/google', gmailOAuthRoute)
  return app
}

describe('GET /api/oauth/google/start', () => {
  it('redirects to Google with PKCE params', async () => {
    const app = mountApp()
    const res = await app.request('http://localhost/api/oauth/google/start')
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')
    expect(loc).toBeTruthy()
    const u = new URL(loc!)
    expect(u.hostname).toBe('accounts.google.com')
    expect(u.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
    expect(u.searchParams.get('redirect_uri')).toBe(googleOAuthRedirectUri())
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('state')).toBeTruthy()
    expect(u.searchParams.get('scope')).toBe(GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE)
  })

  it('redirects with error when OAuth env is missing', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    const app = mountApp()
    const res = await app.request('http://localhost/api/oauth/google/start')
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/oauth/google/error?reason=')
  })
})

describe('GET /api/oauth/google/callback', () => {
  it('writes google-oauth.json and config.json then redirects', async () => {
    const { verifier } = generatePkce()
    const state = 'fixed-state-test'
    putOAuthSession(state, verifier)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'access-token',
              refresh_token: 'refresh-token',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'user@gmail.com', sub: 'userinfo-sub-stable' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
    )

    const app = mountApp()
    const res = await app.request(
      `http://localhost/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/oauth/google/complete')

    const regRaw = await readFile(join(brainHome, '.global', 'tenant-registry.json'), 'utf8')
    const reg = JSON.parse(regRaw) as { identities?: Record<string, string> }
    const tenantUserId = reg.identities?.['google:userinfo-sub-stable']
    expect(tenantUserId).toMatch(/^usr_/)

    const ripmailHome = join(brainHome, tenantUserId!, 'ripmail')
    const tokenPath = join(ripmailHome, 'user_gmail_com', 'google-oauth.json')
    const tokenRaw = await readFile(tokenPath, 'utf8')
    const tok = JSON.parse(tokenRaw) as { refreshToken: string }
    expect(tok.refreshToken).toBe('refresh-token')

    const cfgRaw = await readFile(join(ripmailHome, 'config.json'), 'utf8')
    const cfg = JSON.parse(cfgRaw) as {
      sources: Array<{ id: string; imapAuth: string; email: string }>
    }
    expect(cfg.sources.some((s) => s.id === 'user_gmail_com')).toBe(true)
    expect(cfg.sources.find((s) => s.id === 'user_gmail_com')?.imapAuth).toBe(
      'googleOAuth'
    )

    const prefsPath = join(brainLayoutChatsDir(join(brainHome, tenantUserId!)), 'onboarding', 'preferences.json')
    const prefsRaw = await readFile(prefsPath, 'utf8')
    const prefs = JSON.parse(prefsRaw) as { mailProvider?: string }
    expect(prefs.mailProvider).toBe('google')
  })

  it('redirects on invalid state', async () => {
    const app = mountApp()
    const res = await app.request(
      'http://localhost/api/oauth/google/callback?code=x&state=unknown'
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/oauth/google/error?reason=')
  })

  it('redirects with error when token omits required Gmail scope (partial consent)', async () => {
    const { verifier } = generatePkce()
    const state = 'partial-scope-test'
    putOAuthSession(state, verifier)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'at',
              refresh_token: 'rt',
              expires_in: 3600,
              scope: 'openid email https://www.googleapis.com/auth/calendar.events',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
    )
    const app = mountApp()
    const res = await app.request(
      `http://localhost/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/oauth/google/error?reason=')
    expect(decodeURIComponent(loc)).toMatch(/every permission/i)
  })

  it('redirects with error when token omits Drive scope', async () => {
    const { verifier } = generatePkce()
    const state = 'no-drive-scope-test'
    putOAuthSession(state, verifier)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'at',
              refresh_token: 'rt',
              expires_in: 3600,
              scope:
                'https://mail.google.com/ https://www.googleapis.com/auth/calendar.events openid email',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
    )
    const app = mountApp()
    const res = await app.request(
      `http://localhost/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/oauth/google/error?reason=')
    expect(decodeURIComponent(loc)).toMatch(/Google Drive/i)
  })

  it('GET /api/oauth/google/last-result reports success after callback and clears', async () => {
    const { verifier } = generatePkce()
    const state = 'state-for-last-result'
    putOAuthSession(state, verifier)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'access-token',
              refresh_token: 'refresh-token',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'u@gmail.com', sub: 'last-result-sub' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
    )
    const app = mountApp()
    await app.request(
      `http://localhost/api/oauth/google/callback?code=code&state=${encodeURIComponent(state)}`
    )
    const r1 = await app.request('http://localhost/api/oauth/google/last-result')
    expect(r1.status).toBe(200)
    const j1 = (await r1.json()) as { done: boolean; error?: null | string }
    expect(j1).toEqual({ done: true, error: null })
    const r2 = await app.request('http://localhost/api/oauth/google/last-result')
    const j2 = (await r2.json()) as { done: boolean }
    expect(j2).toEqual({ done: false })
  })

  it('GET /api/oauth/google/last-result reports error after failed callback', async () => {
    const app = mountApp()
    await app.request('http://localhost/api/oauth/google/callback?code=x&state=unknown')
    const r1 = await app.request('http://localhost/api/oauth/google/last-result')
    expect(r1.status).toBe(200)
    const j1 = (await r1.json()) as { done: boolean; error?: string }
    expect(j1.done).toBe(true)
    expect(j1.error).toContain('expired')
  })

  describe('multi-tenant data root', () => {
    let mtRoot: string

    beforeEach(async () => {
      delete process.env.BRAIN_HOME
      mtRoot = await mkdtemp(join(tmpdir(), 'gmail-oauth-mt-'))
      process.env.BRAIN_DATA_ROOT = mtRoot
    })

    afterEach(async () => {
      await rm(mtRoot, { recursive: true, force: true })
      delete process.env.BRAIN_DATA_ROOT
    })

    it('callback provisions workspace, maps identity, sets session cookie', async () => {
      const { verifier } = generatePkce()
      const state = 'state-mt-callback'
      putOAuthSession(state, verifier)

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString()
          if (url.includes('oauth2.googleapis.com/token')) {
            return new Response(
              JSON.stringify({
                access_token: 'access-token',
                refresh_token: 'refresh-token',
                expires_in: 3600,
                scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            )
          }
          if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
            return new Response(
              JSON.stringify({
                email: 'hosted@gmail.com',
                sub: 'google-mt-hosted-sub',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            )
          }
          throw new Error(`unexpected fetch: ${url}`)
        }),
      )

      const app = mountApp()
      const res = await app.request(
        `http://localhost/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      )
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/oauth/google/complete')
      expect(res.headers.get('set-cookie') ?? '').toContain('brain_session=')

      const regRaw = await readFile(join(mtRoot, '.global', 'tenant-registry.json'), 'utf8')
      const reg = JSON.parse(regRaw) as {
        sessions: Record<string, string>
        identities?: Record<string, string>
      }
      expect(Object.keys(reg.sessions).length).toBe(1)
      const tenantUserId = reg.identities?.['google:google-mt-hosted-sub']
      expect(tenantUserId).toMatch(/^usr_/)
      const tokenPath = join(
        mtRoot,
        tenantUserId!,
        'ripmail',
        'hosted_gmail_com',
        'google-oauth.json',
      )
      expect(existsSync(tokenPath)).toBe(true)

      const { brainLayoutChatsDir } = await import('@server/lib/platform/brainLayout.js')
      const prefsPath = join(
        brainLayoutChatsDir(join(mtRoot, tenantUserId!)),
        'onboarding',
        'preferences.json',
      )
      const prefsRaw = await readFile(prefsPath, 'utf8')
      const prefs = JSON.parse(prefsRaw) as { mailProvider?: string }
      expect(prefs.mailProvider).toBe('google')

      const linkedPath = join(mtRoot, tenantUserId!, 'var', 'linked-mailboxes.json')
      const linked = JSON.parse(await readFile(linkedPath, 'utf8')) as {
        mailboxes: { email: string; isPrimary?: boolean }[]
      }
      expect(linked.mailboxes).toHaveLength(1)
      expect(linked.mailboxes[0]).toMatchObject({
        email: 'hosted@gmail.com',
        isPrimary: true,
      })

      const cfgPath = join(mtRoot, tenantUserId!, 'ripmail', 'config.json')
      const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as { defaultSendSource?: string }
      expect(cfg.defaultSendSource).toBe('hosted_gmail_com')
    })
  })
})

/* ──────────────────────────────────────────────────────────────────────────
 * Add-account ("link") flow — OPP-044 phase 1.
 * ────────────────────────────────────────────────────────────────────────── */
describe('GET /api/oauth/google/link/start', () => {
  it('redirects to Google with PKCE when Brain session is present', async () => {
    const uid = generateUserId()
    ensureTenantHomeDir(uid)
    await writeHandleMeta(tenantHomeDir(uid), {
      userId: uid,
      handle: 'link-start-test',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    const sid = await runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: 'link-start-test', homeDir: tenantHomeDir(uid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, uid)

    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.route('/api/oauth/google', gmailOAuthRoute)
    const res = await app.request('http://localhost/api/oauth/google/link/start', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    const u = new URL(loc)
    expect(u.hostname).toBe('accounts.google.com')
    expect(u.searchParams.get('state')).toBeTruthy()
  })

  it('redirects with error when no Brain session is present in multi-tenant mode', async () => {
    const mtRoot = await mkdtemp(join(tmpdir(), 'gmail-oauth-link-mt-noauth-'))
    delete process.env.BRAIN_HOME
    process.env.BRAIN_DATA_ROOT = mtRoot
    try {
      const app = new Hono()
      app.use('/api/*', tenantMiddleware)
      app.route('/api/oauth/google', gmailOAuthRoute)
      const res = await app.request('http://localhost/api/oauth/google/link/start')
      expect(res.status).toBe(302)
      const loc = res.headers.get('location')!
      expect(loc).toContain('/oauth/google/error?reason=')
      expect(decodeURIComponent(loc)).toContain('Sign in to Braintunnel')
    } finally {
      delete process.env.BRAIN_DATA_ROOT
      await rm(mtRoot, { recursive: true, force: true })
    }
  })
})

describe('GET /api/oauth/google/link/callback (tenant session)', () => {
  let tenantUid: string
  let sessionCookieValue: string

  beforeEach(async () => {
    tenantUid = generateUserId()
    ensureTenantHomeDir(tenantUid)
    await writeHandleMeta(tenantHomeDir(tenantUid), {
      userId: tenantUid,
      handle: 'link-callback-test',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    const sid = await runWithTenantContextAsync(
      { tenantUserId: tenantUid, workspaceHandle: 'link-callback-test', homeDir: tenantHomeDir(tenantUid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, tenantUid)
    sessionCookieValue = `brain_session=${sid}`
  })

  function stubFetchOk(opts: { email: string; sub: string }) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
                scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
        return new Response(JSON.stringify({ email: opts.email, sub: opts.sub }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  }

  function mountApp() {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.route('/api/oauth/google', gmailOAuthRoute)
    return app
  }

  it('writes a second mailbox into ripmail config, registers it as linked, and redirects to /hub', async () => {
    // Seed primary IMAP source so the new account is "second".
    const ripmailHome = join(brainHome, tenantUid, 'ripmail')
    await import('node:fs/promises').then((m) => m.mkdir(ripmailHome, { recursive: true }))
    await writeFile(
      join(ripmailHome, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'primary_gmail_com',
            kind: 'imap',
            email: 'primary@gmail.com',
            imap: { host: 'imap.gmail.com', port: 993 },
            imapAuth: 'googleOAuth',
          },
        ],
      }),
    )

    const { verifier } = generatePkce()
    const state = 'link-state-1'
    putOAuthSession(state, verifier, { mode: 'link' })

    vi.stubGlobal('fetch', stubFetchOk({ email: 'second@gmail.com', sub: 'sub-second' }))

    const res = await mountApp().request(
      `http://localhost/api/oauth/google/link/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: sessionCookieValue } },
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/settings?addedAccount=')
    expect(decodeURIComponent(loc)).toContain('second@gmail.com')

    const cfg = JSON.parse(await readFile(join(ripmailHome, 'config.json'), 'utf8')) as {
      sources: Array<{ id: string; kind: string; email?: string }>
    }
    expect(cfg.sources.some((s) => s.id === 'second_gmail_com' && s.kind === 'imap')).toBe(true)
    expect(cfg.sources.some((s) => s.id === 'second_gmail_com-gcal' && s.kind === 'googleCalendar')).toBe(true)

    const linkedRaw = await readFile(join(brainHome, tenantUid, 'var', 'linked-mailboxes.json'), 'utf8')
    const linked = JSON.parse(linkedRaw) as { mailboxes: { email: string; isPrimary?: boolean }[] }
    expect(linked.mailboxes.some((m) => m.email === 'second@gmail.com' && m.isPrimary !== true)).toBe(true)

    const tokenPath = join(ripmailHome, 'second_gmail_com', 'google-oauth.json')
    expect(existsSync(tokenPath)).toBe(true)
  })

  it('shared /callback with mode link writes second mailbox (same URI Google redirects to)', async () => {
    const ripmailHome = join(brainHome, tenantUid, 'ripmail')
    await import('node:fs/promises').then((m) => m.mkdir(ripmailHome, { recursive: true }))
    await writeFile(
      join(ripmailHome, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'primary_gmail_com',
            kind: 'imap',
            email: 'primary@gmail.com',
            imap: { host: 'imap.gmail.com', port: 993 },
            imapAuth: 'googleOAuth',
          },
        ],
      }),
    )

    const { verifier } = generatePkce()
    const state = 'link-state-via-main-callback'
    putOAuthSession(state, verifier, { mode: 'link' })

    vi.stubGlobal('fetch', stubFetchOk({ email: 'second@gmail.com', sub: 'sub-second' }))

    const res = await mountApp().request(
      `http://localhost/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: sessionCookieValue } },
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/settings?addedAccount=')
    expect(decodeURIComponent(loc)).toContain('second@gmail.com')

    const cfg = JSON.parse(await readFile(join(ripmailHome, 'config.json'), 'utf8')) as {
      sources: Array<{ id: string; kind: string; email?: string }>
    }
    expect(cfg.sources.some((s) => s.id === 'second_gmail_com' && s.kind === 'imap')).toBe(true)
  })

  it('refreshes tokens but does not duplicate when the same email is re-linked', async () => {
    const ripmailHome = join(brainHome, tenantUid, 'ripmail')
    await import('node:fs/promises').then((m) => m.mkdir(ripmailHome, { recursive: true }))
    await writeFile(
      join(ripmailHome, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'work_example_com',
            kind: 'imap',
            email: 'work@example.com',
            imap: { host: 'imap.gmail.com', port: 993 },
            imapAuth: 'googleOAuth',
          },
        ],
      }),
    )
    await import('node:fs/promises').then((m) => m.mkdir(join(brainHome, tenantUid, 'var'), { recursive: true }))
    await writeFile(
      join(brainHome, tenantUid, 'var', 'linked-mailboxes.json'),
      JSON.stringify({
        v: 1,
        mailboxes: [
          {
            email: 'work@example.com',
            googleSub: 'sub-work',
            linkedAt: '2026-04-20T00:00:00.000Z',
          },
        ],
      }),
    )

    const { verifier } = generatePkce()
    const state = 'link-state-relink'
    putOAuthSession(state, verifier, { mode: 'link' })

    vi.stubGlobal('fetch', stubFetchOk({ email: 'work@example.com', sub: 'sub-work' }))
    const res = await mountApp().request(
      `http://localhost/api/oauth/google/link/callback?code=auth-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: sessionCookieValue } },
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/settings?addedAccount=')

    const cfg = JSON.parse(await readFile(join(ripmailHome, 'config.json'), 'utf8')) as {
      sources: Array<{ id: string; kind: string }>
    }
    const imapEntries = cfg.sources.filter((s) => s.kind === 'imap')
    expect(imapEntries).toHaveLength(1)

    const linked = JSON.parse(
      await readFile(join(brainHome, tenantUid, 'var', 'linked-mailboxes.json'), 'utf8'),
    ) as { mailboxes: { email: string }[] }
    expect(linked.mailboxes).toHaveLength(1)
  })

  it('refuses a state generated by /start (signIn mode) — link callback only consumes link state', async () => {
    const { verifier } = generatePkce()
    const state = 'state-but-signin-mode'
    putOAuthSession(state, verifier) // default signIn

    const res = await mountApp().request(
      `http://localhost/api/oauth/google/link/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/settings?addAccountError=')
  })

  it('redirects with error on invalid state', async () => {
    const res = await mountApp().request(
      'http://localhost/api/oauth/google/link/callback?code=x&state=unknown',
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/settings?addAccountError=')
    expect(decodeURIComponent(loc)).toContain('expired')
  })
})

describe('GET /api/oauth/google/link/callback (multi-tenant)', () => {
  let mtRoot: string

  beforeEach(async () => {
    delete process.env.BRAIN_HOME
    mtRoot = await mkdtemp(join(tmpdir(), 'gmail-oauth-link-mt-'))
    process.env.BRAIN_DATA_ROOT = mtRoot
  })

  afterEach(async () => {
    await rm(mtRoot, { recursive: true, force: true })
    delete process.env.BRAIN_DATA_ROOT
  })

  function mountApp() {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.route('/api/oauth/google', gmailOAuthRoute)
    return app
  }

  it('refuses to link when no Brain session cookie is present', async () => {
    const { verifier } = generatePkce()
    const state = 'mt-link-no-session'
    putOAuthSession(state, verifier, { mode: 'link' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'tok',
              refresh_token: 'refresh',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(JSON.stringify({ email: 'x@gmail.com', sub: 'sub-x' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const res = await mountApp().request(
      `http://localhost/api/oauth/google/link/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    )
    expect(res.status).toBe(302)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/settings?addAccountError=')
    expect(decodeURIComponent(loc)).toContain('session expired')
  })

  it('writes the linked mailbox into the existing tenant when a Brain session is present', async () => {
    // Bootstrap a tenant by simulating a primary OAuth callback (single-tenant style would not apply
    // because we are in MT mode; instead, hit /callback to create the workspace).
    const { brainLayoutChatsDir } = await import('@server/lib/platform/brainLayout.js')

    const primaryState = 'mt-primary-1'
    const primaryPkce = generatePkce()
    putOAuthSession(primaryState, primaryPkce.verifier)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'tok',
              refresh_token: 'refresh',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'work@gmail.com', sub: 'sub-work-mt' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const app = mountApp()
    const primaryRes = await app.request(
      `http://localhost/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(primaryState)}`,
    )
    expect(primaryRes.status).toBe(302)
    const cookieHeader = primaryRes.headers.get('set-cookie')!
    const sessionMatch = cookieHeader.match(/brain_session=([^;]+)/)
    expect(sessionMatch).toBeTruthy()
    const sessionCookieValue = `brain_session=${sessionMatch![1]}`

    const reg = JSON.parse(
      await readFile(join(mtRoot, '.global', 'tenant-registry.json'), 'utf8'),
    ) as { identities?: Record<string, string> }
    const tenantUserId = reg.identities!['google:sub-work-mt']!
    expect(tenantUserId).toMatch(/^usr_/)
    void brainLayoutChatsDir

    // Now run the link flow.
    const linkState = 'mt-link-1'
    const linkPkce = generatePkce()
    putOAuthSession(linkState, linkPkce.verifier, { mode: 'link' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'tok2',
              refresh_token: 'refresh2',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'personal@gmail.com', sub: 'sub-personal-mt' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const linkRes = await app.request(
      `http://localhost/api/oauth/google/link/callback?code=auth-code-2&state=${encodeURIComponent(linkState)}`,
      { headers: { Cookie: sessionCookieValue } },
    )
    expect(linkRes.status).toBe(302)
    expect(linkRes.headers.get('location')).toContain('/settings?addedAccount=')

    // The new mailbox should sit under the SAME tenant directory.
    const linked = JSON.parse(
      await readFile(join(mtRoot, tenantUserId, 'var', 'linked-mailboxes.json'), 'utf8'),
    ) as { mailboxes: { email: string; isPrimary?: boolean }[] }
    const emails = linked.mailboxes.map((m) => m.email).sort()
    expect(emails).toEqual(['personal@gmail.com', 'work@gmail.com'])
    expect(linked.mailboxes.find((m) => m.email === 'work@gmail.com')?.isPrimary).toBe(true)
    expect(linked.mailboxes.find((m) => m.email === 'personal@gmail.com')?.isPrimary).not.toBe(true)

    // The tenant-registry identities map should still only have the primary identity.
    const reg2 = JSON.parse(
      await readFile(join(mtRoot, '.global', 'tenant-registry.json'), 'utf8'),
    ) as { identities?: Record<string, string> }
    expect(reg2.identities!['google:sub-work-mt']).toBe(tenantUserId)
    expect(reg2.identities!['google:sub-personal-mt']).toBeUndefined()

    const tokenPath = join(mtRoot, tenantUserId, 'ripmail', 'personal_gmail_com', 'google-oauth.json')
    expect(existsSync(tokenPath)).toBe(true)
  })

  it('refuses linking a Google identity that is the primary of a different workspace', async () => {
    // Pre-create a different tenant with this identity by inserting into tenant-registry directly.
    await import('node:fs/promises').then((m) => m.mkdir(join(mtRoot, '.global'), { recursive: true }))
    await writeFile(
      join(mtRoot, '.global', 'tenant-registry.json'),
      JSON.stringify({
        v: 1,
        sessions: {},
        identities: { 'google:sub-other-owner': 'usr_already_exists_xxxxxxxxxxxx' },
      }),
    )

    // Provision the current tenant via primary flow.
    const primaryState = 'mt-primary-collide'
    const primaryPkce = generatePkce()
    putOAuthSession(primaryState, primaryPkce.verifier)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'tok',
              refresh_token: 'refresh',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'me@gmail.com', sub: 'sub-me-mt' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    const app = mountApp()
    const primaryRes = await app.request(
      `http://localhost/api/oauth/google/callback?code=auth-code&state=${encodeURIComponent(primaryState)}`,
    )
    const cookieHeader = primaryRes.headers.get('set-cookie')!
    const sessionMatch = cookieHeader.match(/brain_session=([^;]+)/)
    const sessionCookieValue = `brain_session=${sessionMatch![1]}`

    // Attempt to link a Google account that already maps to a different tenant.
    const linkState = 'mt-link-collide'
    const linkPkce = generatePkce()
    putOAuthSession(linkState, linkPkce.verifier, { mode: 'link' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'tok2',
              refresh_token: 'refresh2',
              expires_in: 3600,
              scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'shared@gmail.com', sub: 'sub-other-owner' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const linkRes = await app.request(
      `http://localhost/api/oauth/google/link/callback?code=auth-code-2&state=${encodeURIComponent(linkState)}`,
      { headers: { Cookie: sessionCookieValue } },
    )
    expect(linkRes.status).toBe(302)
    const loc = linkRes.headers.get('location')!
    expect(loc).toContain('/settings?addAccountError=')
    expect(decodeURIComponent(loc)).toContain('different Braintunnel workspace')
  })
})

describe('GET /api/oauth/google/linked', () => {
  it('returns linked mailboxes for the signed-in tenant', async () => {
    const uid = generateUserId()
    ensureTenantHomeDir(uid)
    await writeHandleMeta(tenantHomeDir(uid), {
      userId: uid,
      handle: 'linked-list-test',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    const sid = await runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: 'linked-list-test', homeDir: tenantHomeDir(uid) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, uid)

    await import('node:fs/promises').then((m) => m.mkdir(join(brainHome, uid, 'var'), { recursive: true }))
    await writeFile(
      join(brainHome, uid, 'var', 'linked-mailboxes.json'),
      JSON.stringify({
        v: 1,
        mailboxes: [
          {
            email: 'a@gmail.com',
            googleSub: 'sub-a',
            linkedAt: '2026-04-20T00:00:00.000Z',
            isPrimary: true,
          },
          {
            email: 'b@gmail.com',
            googleSub: 'sub-b',
            linkedAt: '2026-04-25T00:00:00.000Z',
          },
        ],
      }),
    )
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.route('/api/oauth/google', gmailOAuthRoute)
    const res = await app.request('http://localhost/api/oauth/google/linked', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { mailboxes: { email: string; isPrimary: boolean }[] }
    expect(j.mailboxes).toHaveLength(2)
    expect(j.mailboxes.find((m) => m.email === 'a@gmail.com')?.isPrimary).toBe(true)
    expect(j.mailboxes.find((m) => m.email === 'b@gmail.com')?.isPrimary).toBe(false)
  })

  it('returns 401 in multi-tenant mode without a session', async () => {
    const mtRoot = await mkdtemp(join(tmpdir(), 'gmail-oauth-linked-noauth-'))
    delete process.env.BRAIN_HOME
    process.env.BRAIN_DATA_ROOT = mtRoot
    try {
      const app = new Hono()
      app.use('/api/*', tenantMiddleware)
      app.route('/api/oauth/google', gmailOAuthRoute)
      const res = await app.request('http://localhost/api/oauth/google/linked')
      expect(res.status).toBe(401)
    } finally {
      delete process.env.BRAIN_DATA_ROOT
      await rm(mtRoot, { recursive: true, force: true })
    }
  })
})
