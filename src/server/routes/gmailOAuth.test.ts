import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import gmailOAuthRoute from './gmailOAuth.js'
import {
  clearGmailOAuthSessionsForTests,
  putOAuthSession,
} from '../lib/gmailOAuthState.js'
import { clearGoogleOauthDesktopResultForTests } from '../lib/googleOauthDesktopResult.js'
import { googleOAuthRedirectUri } from '../lib/brainHttpPort.js'
import { generatePkce } from '../lib/googleOAuth.js'

let brainHome: string
let savedRipmailHome: string | undefined

beforeEach(async () => {
  savedRipmailHome = process.env.RIPMAIL_HOME
  delete process.env.RIPMAIL_HOME
  brainHome = await mkdtemp(join(tmpdir(), 'gmail-oauth-route-'))
  process.env.BRAIN_HOME = brainHome
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com'
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret'
  clearGmailOAuthSessionsForTests()
  clearGoogleOauthDesktopResultForTests()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(brainHome, { recursive: true, force: true })
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
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'user@gmail.com' }),
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

    const ripmailHome = join(brainHome, 'ripmail')
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
  })

  it('redirects on invalid state', async () => {
    const app = mountApp()
    const res = await app.request(
      'http://localhost/api/oauth/google/callback?code=x&state=unknown'
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/oauth/google/error?reason=')
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
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
          return new Response(
            JSON.stringify({ email: 'u@gmail.com' }),
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
})
