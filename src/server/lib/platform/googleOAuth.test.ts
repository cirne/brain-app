import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveMailboxId,
  exchangeAuthorizationCode,
  fetchGoogleUserInfo,
  generatePkce,
  buildGoogleAuthorizeUrl,
  upsertRipmailConfig,
  upsertRipmailGoogleCalendarSource,
  upsertRipmailGoogleDriveSource,
  ensureGoogleDriveSourcesForOAuthImap,
  validateGoogleOAuthGrantedScopes,
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

describe('fetchGoogleUserInfo', () => {
  it('returns email and sub from userinfo JSON', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ email: '  U@Mail.com ', sub: ' google-sub-id ' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    const u = await fetchGoogleUserInfo({
      accessToken: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(u.email).toBe('U@Mail.com')
    expect(u.sub).toBe('google-sub-id')
    expect(u.name).toBeUndefined()
  })

  it('returns trimmed name when profile scope is granted', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ email: 'a@b.co', sub: 'sub-1', name: '  Lewis Cirne  ' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    const u = await fetchGoogleUserInfo({
      accessToken: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(u.name).toBe('Lewis Cirne')
  })

  it('omits name when userinfo returns an empty string', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ email: 'a@b.co', sub: 'sub-1', name: '   ' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    const u = await fetchGoogleUserInfo({
      accessToken: 'tok',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(u.name).toBeUndefined()
  })

  it('errors when sub is missing', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ email: 'a@b.co' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    await expect(
      fetchGoogleUserInfo({ accessToken: 'tok', fetchImpl: fetchImpl as typeof fetch }),
    ).rejects.toThrow(/missing sub/)
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
          scope: 'openid email',
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
    expect(out.scope).toBe('openid email')
    expect(fetchImpl).toHaveBeenCalled()
  })
})

describe('validateGoogleOAuthGrantedScopes', () => {
  const base =
    'https://mail.google.com/ https://www.googleapis.com/auth/calendar.events openid email profile'

  it('rejects when mail+calendar+openid+email but Drive read-only missing', () => {
    const r = validateGoogleOAuthGrantedScopes(base)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/Google Drive/i)
  })

  it('accepts full scope including Drive read-only and profile', () => {
    const s = `${base} https://www.googleapis.com/auth/drive.readonly`
    expect(validateGoogleOAuthGrantedScopes(s)).toEqual({ ok: true })
  })

  it('accepts userinfo.email and userinfo.profile aliases', () => {
    const s =
      'https://mail.google.com/ https://www.googleapis.com/auth/calendar.events openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.readonly'
    expect(validateGoogleOAuthGrantedScopes(s)).toEqual({ ok: true })
  })

  it('rejects missing Gmail scope (partial consent)', () => {
    const r = validateGoogleOAuthGrantedScopes(
      'https://www.googleapis.com/auth/calendar.events openid email profile',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/every permission/i)
  })

  it('rejects when profile scope is missing', () => {
    const without =
      'https://mail.google.com/ https://www.googleapis.com/auth/calendar.events openid email https://www.googleapis.com/auth/drive.readonly'
    const r = validateGoogleOAuthGrantedScopes(without)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/profile|name/i)
  })

  it('rejects empty scope', () => {
    const r = validateGoogleOAuthGrantedScopes(undefined)
    expect(r.ok).toBe(false)
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

describe('upsertRipmailGoogleDriveSource', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ripmail-gdrive-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('adds googleDrive next to imap with empty folder roots', async () => {
    await upsertRipmailConfig(home, 'a_gmail_com', 'a@gmail.com')
    await upsertRipmailGoogleDriveSource(home, 'a_gmail_com', 'a@gmail.com')
    const raw = await readFile(join(home, 'config.json'), 'utf8')
    const j = JSON.parse(raw) as {
      sources: Array<{
        id: string
        kind: string
        oauthSourceId?: string
        email?: string
        fileSource?: { roots: unknown[] }
      }>
    }
    const gd = j.sources.find((s) => s.kind === 'googleDrive')
    expect(gd).toBeDefined()
    expect(gd!.id).toBe('a_gmail_com-drive')
    expect(gd!.oauthSourceId).toBe('a_gmail_com')
    expect(gd!.email).toBe('a@gmail.com')
    expect(Array.isArray(gd!.fileSource?.roots)).toBe(true)
    expect(gd!.fileSource!.roots).toHaveLength(0)
  })
})

describe('ensureGoogleDriveSourcesForOAuthImap', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ripmail-ensure-gd-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('adds googleDrive when oauth imap exists but drive sibling missing', async () => {
    await upsertRipmailConfig(home, 'x_gmail_com', 'x@gmail.com')
    await upsertRipmailGoogleCalendarSource(home, 'x_gmail_com', 'x@gmail.com')
    await ensureGoogleDriveSourcesForOAuthImap(home)
    const raw = await readFile(join(home, 'config.json'), 'utf8')
    const j = JSON.parse(raw) as { sources: Array<{ kind: string }> }
    expect(j.sources.some((s) => s.kind === 'googleDrive')).toBe(true)
  })
})
