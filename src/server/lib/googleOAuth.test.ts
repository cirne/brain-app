import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveMailboxId,
  exchangeAuthorizationCode,
  generatePkce,
  buildGoogleAuthorizeUrl,
  upsertRipmailConfig,
  upsertRipmailGoogleCalendarSource,
  writeGoogleOAuthTokenFile,
} from './googleOAuth.js'

describe('deriveMailboxId', () => {
  it('lowercases and maps @ and . to underscore', () => {
    expect(deriveMailboxId('LewisCirne@gmail.com')).toBe('lewiscirne_gmail_com')
  })
})

describe('generatePkce', () => {
  it('produces verifier and S256 challenge', () => {
    const a = generatePkce()
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
    expect(a.challenge.length).toBeGreaterThan(0)
    expect(a.challenge).not.toContain('=')
    const b = generatePkce()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('buildGoogleAuthorizeUrl', () => {
  it('includes PKCE and offline parameters', () => {
    const u = buildGoogleAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'http://localhost:3000/cb',
      scope: 'openid email',
      state: 'st',
      codeChallenge: 'ch',
    })
    expect(u.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
    const parsed = new URL(u)
    expect(parsed.searchParams.get('client_id')).toBe('cid')
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/cb')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
  })
})

describe('exchangeAuthorizationCode', () => {
  it('parses token JSON', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
        }),
        { status: 200 }
      )
    })
    const out = await exchangeAuthorizationCode({
      clientId: 'id',
      clientSecret: 'sec',
      redirectUri: 'http://localhost/cb',
      code: 'c',
      codeVerifier: 'v',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(out.accessToken).toBe('at')
    expect(out.refreshToken).toBe('rt')
    expect(out.expiresIn).toBe(3600)
    expect(fetchImpl).toHaveBeenCalled()
  })
})

describe('writeGoogleOAuthTokenFile', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gmail-oauth-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes camelCase google-oauth.json', async () => {
    await writeGoogleOAuthTokenFile(dir, 'u_gmail_com', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 100,
    })
    const raw = await readFile(join(dir, 'u_gmail_com', 'google-oauth.json'), 'utf8')
    const j = JSON.parse(raw) as {
      refreshToken: string
      accessToken: string
      accessTokenExpiresAt: number
    }
    expect(j.refreshToken).toBe('r')
    expect(j.accessToken).toBe('a')
    expect(typeof j.accessTokenExpiresAt).toBe('number')
    if (process.platform !== 'win32') {
      const mode = statSync(join(dir, 'u_gmail_com', 'google-oauth.json')).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })
})

describe('upsertRipmailConfig', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ripmail-cfg-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('creates sources + sync defaults', async () => {
    await upsertRipmailConfig(home, 'a_gmail_com', 'a@gmail.com')
    const raw = await readFile(join(home, 'config.json'), 'utf8')
    const j = JSON.parse(raw) as {
      sources: Array<{ id: string; imapAuth: string; imap: { host: string; port: number } }>
      sync: { defaultSince: string; excludeLabels: string[] }
    }
    expect(j.sources).toHaveLength(1)
    expect(j.sources[0].id).toBe('a_gmail_com')
    expect(j.sources[0].imapAuth).toBe('googleOAuth')
    expect(j.sources[0].imap.host).toBe('imap.gmail.com')
    expect(j.sync.defaultSince).toBe('1y')
    expect(j.sync.excludeLabels).toContain('Trash')
  })

  it('upserts second mailbox without removing first', async () => {
    await upsertRipmailConfig(home, 'a_gmail_com', 'a@gmail.com')
    await upsertRipmailConfig(home, 'b_gmail_com', 'b@gmail.com')
    const raw = await readFile(join(home, 'config.json'), 'utf8')
    const j = JSON.parse(raw) as { sources: Array<{ id: string; email: string }> }
    expect(j.sources).toHaveLength(2)
    expect(j.sources.map((s) => s.email).sort()).toEqual(['a@gmail.com', 'b@gmail.com'])
  })

  it('preserves search when updating same id', async () => {
    await upsertRipmailConfig(home, 'a_gmail_com', 'a@gmail.com')
    const path = join(home, 'config.json')
    let raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as {
      sources: Array<{ search?: { includeInDefault: boolean } }>
    }
    parsed.sources[0].search = { includeInDefault: false }
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    await upsertRipmailConfig(home, 'a_gmail_com', 'a@gmail.com')
    raw = await readFile(path, 'utf8')
    const j = JSON.parse(raw) as {
      sources: Array<{ search?: { includeInDefault: boolean } }>
    }
    expect(j.sources[0].search?.includeInDefault).toBe(false)
  })
})

describe('upsertRipmailGoogleCalendarSource', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ripmail-gcal-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('adds googleCalendar next to imap source', async () => {
    await upsertRipmailConfig(home, 'a_gmail_com', 'a@gmail.com')
    await upsertRipmailGoogleCalendarSource(home, 'a_gmail_com', 'a@gmail.com')
    const raw = await readFile(join(home, 'config.json'), 'utf8')
    const j = JSON.parse(raw) as {
      sources: Array<{ id: string; kind: string; oauthSourceId?: string; calendarIds?: string[] }>
    }
    expect(j.sources.length).toBeGreaterThanOrEqual(2)
    const gcal = j.sources.find((s) => s.kind === 'googleCalendar')
    expect(gcal).toBeDefined()
    expect(gcal!.oauthSourceId).toBe('a_gmail_com')
    expect(gcal!.calendarIds).toEqual(['primary'])
  })
})
