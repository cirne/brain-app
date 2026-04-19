/**
 * Google OAuth 2.0 (PKCE) for Gmail + userinfo — writes the same on-disk shape as ripmail
 * (`google-oauth.json` + `config.json` with `imapAuth: "googleOAuth"`).
 */
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Mail + OpenID + email (discover mailbox address after sign-in). Matches ripmail `GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL`. */
export const GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL =
  'https://mail.google.com/ openid email'

/** Gmail IMAP + Google Calendar read + OpenID/email discovery — matches `ripmail` `GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_READONLY`. */
export const GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_READONLY =
  'https://mail.google.com/ https://www.googleapis.com/auth/calendar.readonly openid email'

const GOOGLE_AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URI = 'https://www.googleapis.com/oauth2/v3/userinfo'

export function deriveMailboxId(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/[@.]/g, '_')
}

/** RFC 7636 PKCE: 43+ char verifier + S256 challenge (base64url, no padding). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(verifier, 'utf8').digest()
  const challenge = Buffer.from(hash).toString('base64url')
  return { verifier, challenge }
}

export function buildGoogleAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
  authUri?: string
}): string {
  const base = (params.authUri ?? GOOGLE_AUTH_URI).trim()
  const q = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: params.scope,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${base}?${q.toString()}`
}

export type GoogleTokenResponse = {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

export class GoogleOAuthExchangeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message)
    this.name = 'GoogleOAuthExchangeError'
  }
}

export async function exchangeAuthorizationCode(params: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
  codeVerifier: string
  tokenUri?: string
  fetchImpl?: typeof fetch
}): Promise<GoogleTokenResponse> {
  const tokenUri = params.tokenUri ?? GOOGLE_TOKEN_URI
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.codeVerifier,
  })
  const fetchFn = params.fetchImpl ?? fetch
  const res = await fetchFn(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new GoogleOAuthExchangeError(
      `token endpoint HTTP ${res.status}`,
      res.status,
      text
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new GoogleOAuthExchangeError('token response is not JSON', res.status, text)
  }
  const o = parsed as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (o.error) {
    throw new GoogleOAuthExchangeError(
      `OAuth error: ${o.error} (${o.error_description ?? ''})`,
      res.status,
      text
    )
  }
  if (!o.access_token) {
    throw new GoogleOAuthExchangeError('token response missing access_token', res.status, text)
  }
  return {
    accessToken: o.access_token,
    refreshToken: o.refresh_token,
    expiresIn: o.expires_in,
  }
}

export async function fetchGoogleUserEmail(params: {
  accessToken: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchFn = params.fetchImpl ?? fetch
  const res = await fetchFn(GOOGLE_USERINFO_URI, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new GoogleOAuthExchangeError(
      `userinfo HTTP ${res.status}`,
      res.status,
      text
    )
  }
  const j = JSON.parse(text) as { email?: string }
  const email = j.email?.trim()
  if (!email) {
    throw new GoogleOAuthExchangeError('userinfo missing email', res.status, text)
  }
  return email
}

/** Matches ripmail `GoogleOAuthTokenStore` JSON (camelCase). */
export type GoogleOAuthTokenStoreJson = {
  refreshToken: string
  accessToken?: string
  accessTokenExpiresAt?: number
}

export async function writeGoogleOAuthTokenFile(
  ripmailHome: string,
  mailboxId: string,
  tokens: GoogleTokenResponse
): Promise<void> {
  const dir = join(ripmailHome, mailboxId)
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'google-oauth.json')
  const nowSec = Math.floor(Date.now() / 1000)
  const store: GoogleOAuthTokenStoreJson = {
    refreshToken: tokens.refreshToken ?? '',
    accessToken: tokens.accessToken,
    accessTokenExpiresAt:
      tokens.expiresIn !== undefined ? nowSec + tokens.expiresIn : undefined,
  }
  if (!store.refreshToken) {
    throw new Error('Google did not return refresh_token; revoke app access and retry')
  }
  const raw = `${JSON.stringify(store, null, 2)}\n`
  await writeFile(path, raw, 'utf8')
  try {
    await chmod(path, 0o600)
  } catch {
    /* non-Unix */
  }
}

/** Minimal ripmail `config.json` source entry (camelCase keys). */
export type RipmailSourceEntry = {
  id: string
  kind: 'imap'
  email: string
  imap: { host: string; port: number }
  imapAuth: 'googleOAuth'
  search?: { includeInDefault?: boolean }
  identity?: Record<string, unknown>
  label?: string
}

/** `config.json` entry for `googleCalendar` sources (OAuth token reuse from an `imap` mailbox id). */
export type RipmailGoogleCalendarSourceEntry = {
  id: string
  kind: 'googleCalendar'
  email: string
  oauthSourceId: string
  calendarIds?: string[]
}

export type RipmailConfigJson = {
  sources?: Array<RipmailSourceEntry | RipmailGoogleCalendarSourceEntry>
  imap?: unknown
  sync?: {
    defaultSince?: string
    mailbox?: string
    excludeLabels?: string[]
  }
}

export async function upsertRipmailConfig(
  ripmailHome: string,
  mailboxId: string,
  email: string
): Promise<void> {
  await mkdir(ripmailHome, { recursive: true })
  const path = join(ripmailHome, 'config.json')
  let cfg: RipmailConfigJson = {}
  try {
    const raw = await readFile(path, 'utf8')
    cfg = JSON.parse(raw) as RipmailConfigJson
  } catch {
    /* new file */
  }

  const base: RipmailSourceEntry = {
    id: mailboxId,
    kind: 'imap',
    email: email.trim(),
    imap: { host: 'imap.gmail.com', port: 993 },
    imapAuth: 'googleOAuth',
  }

  const sources = [...(cfg.sources ?? [])]
  const idx = sources.findIndex((s) => s.id === mailboxId)
  if (idx >= 0) {
    const prev = sources[idx]
    if (prev.kind === 'imap') {
      sources[idx] = {
        ...base,
        search: prev.search,
        identity: prev.identity,
        label: prev.label,
      }
    } else {
      sources[idx] = base
    }
  } else {
    sources.push(base)
  }

  cfg.sources = sources
  if (cfg.sources.length > 0) {
    cfg.imap = undefined
  }
  if (!cfg.sync) {
    cfg.sync = {
      defaultSince: '1y',
      mailbox: '',
      excludeLabels: ['Trash', 'Spam'],
    }
  }

  const out = `${JSON.stringify(cfg, null, 2)}\n`
  await writeFile(path, out, 'utf8')
}

/** Adds or updates a `googleCalendar` source that reuses `google-oauth.json` under `mailboxId`. */
export async function upsertRipmailGoogleCalendarSource(
  ripmailHome: string,
  mailboxId: string,
  email: string,
): Promise<void> {
  await mkdir(ripmailHome, { recursive: true })
  const path = join(ripmailHome, 'config.json')
  let cfg: RipmailConfigJson = {}
  try {
    const raw = await readFile(path, 'utf8')
    cfg = JSON.parse(raw) as RipmailConfigJson
  } catch {
    /* new file */
  }

  const calId = `${mailboxId}-gcal`
  const entry: RipmailGoogleCalendarSourceEntry = {
    id: calId,
    kind: 'googleCalendar',
    email: email.trim(),
    oauthSourceId: mailboxId,
    calendarIds: ['primary'],
  }

  const sources = [...(cfg.sources ?? [])] as Array<
    RipmailSourceEntry | RipmailGoogleCalendarSourceEntry
  >
  const idx = sources.findIndex((s) => s.id === calId)
  if (idx >= 0) {
    sources[idx] = entry
  } else {
    sources.push(entry)
  }

  cfg.sources = sources as RipmailConfigJson['sources']
  const out = `${JSON.stringify(cfg, null, 2)}\n`
  await writeFile(path, out, 'utf8')
}

/**
 * Ensures each Gmail-OAuth IMAP source has a sibling `googleCalendar` entry (reusing the same
 * `google-oauth.json`). Callers that only ran `upsertRipmailConfig` before calendar support shipped,
 * or imported mail-only ripmail config, can otherwise have mail indexed with no calendar source —
 * `ripmail calendar list-calendars` is empty and `get_calendar_events` always returns no rows.
 */
export async function ensureGoogleCalendarSourcesForOAuthImap(ripmailHome: string): Promise<void> {
  const path = join(ripmailHome, 'config.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return
  }
  let cfg: RipmailConfigJson
  try {
    cfg = JSON.parse(raw) as RipmailConfigJson
  } catch {
    return
  }
  const sources = cfg.sources ?? []
  const covered = new Set<string>()
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue
    const o = s as { kind?: string; oauthSourceId?: string }
    if (o.kind === 'googleCalendar' && typeof o.oauthSourceId === 'string' && o.oauthSourceId.trim()) {
      covered.add(o.oauthSourceId.trim())
    }
  }
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue
    const o = s as { kind?: string; id?: string; email?: string; imapAuth?: string }
    if (o.kind !== 'imap') continue
    if (o.imapAuth !== 'googleOAuth') continue
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const email = typeof o.email === 'string' ? o.email.trim() : ''
    if (!id || !email) continue
    if (covered.has(id)) continue
    await upsertRipmailGoogleCalendarSource(ripmailHome, id, email)
    covered.add(id)
  }
}
