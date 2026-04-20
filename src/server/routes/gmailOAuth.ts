import { Hono, type Context } from 'hono'
import { googleOAuthRedirectUri } from '../lib/brainHttpPort.js'
import { ripmailHomeForBrain } from '../lib/brainHome.js'
import {
  buildGoogleAuthorizeUrl,
  deriveMailboxId,
  exchangeAuthorizationCode,
  fetchGoogleUserEmail,
  generatePkce,
  GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_READONLY,
  upsertRipmailConfig,
  upsertRipmailGoogleCalendarSource,
  writeGoogleOAuthTokenFile,
} from '../lib/googleOAuth.js'
import {
  newOAuthState,
  putOAuthSession,
  takeOAuthVerifier,
} from '../lib/gmailOAuthState.js'
import {
  recordGoogleOauthError,
  recordGoogleOauthSuccess,
  takeGoogleOauthDesktopResult,
} from '../lib/googleOauthDesktopResult.js'

const app = new Hono()

function getOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return null
  }
  return { clientId, clientSecret, redirectUri: googleOAuthRedirectUri() }
}

function redirectOauthError(c: Context, message: string) {
  recordGoogleOauthError(message)
  const q = encodeURIComponent(message)
  return c.redirect(`/oauth/google/error?reason=${q}`, 302)
}

app.get('/start', (c) => {
  const oauth = getOAuthConfig()
  if (!oauth) {
    return redirectOauthError(
      c,
      'Gmail connection is not configured (missing Google OAuth client credentials).'
    )
  }
  const { verifier, challenge } = generatePkce()
  const state = newOAuthState()
  putOAuthSession(state, verifier)
  const url = buildGoogleAuthorizeUrl({
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_READONLY,
    state,
    codeChallenge: challenge,
  })
  return c.redirect(url)
})

app.get('/last-result', (c) => {
  const r = takeGoogleOauthDesktopResult()
  if (!r.done) {
    return c.json({ done: false as const })
  }
  if (r.ok) {
    return c.json({ done: true as const, error: null as null })
  }
  return c.json({ done: true as const, error: r.error })
})

app.get('/callback', async (c) => {
  const oauth = getOAuthConfig()
  if (!oauth) {
    return redirectOauthError(
      c,
      'Gmail connection is not configured (missing Google OAuth client credentials).'
    )
  }
  const providerErr = c.req.query('error')
  const providerDesc = c.req.query('error_description')
  if (providerErr) {
    const msg = providerDesc ? `${providerErr}: ${providerDesc}` : providerErr
    return redirectOauthError(c, msg)
  }
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return redirectOauthError(
      c,
      'Missing code or state from Google. Return to Braintunnel and start Connect Google again.'
    )
  }
  const verifier = takeOAuthVerifier(state)
  if (!verifier) {
    return redirectOauthError(
      c,
      'Sign-in session expired. Return to Braintunnel and use Connect Google again.'
    )
  }
  let tokens
  try {
    tokens = await exchangeAuthorizationCode({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      redirectUri: oauth.redirectUri,
      code,
      codeVerifier: verifier,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return redirectOauthError(c, msg)
  }
  if (!tokens.refreshToken) {
    return redirectOauthError(
      c,
      'No refresh token — revoke Braintunnel access in your Google account and connect again from Braintunnel.'
    )
  }
  let email: string
  try {
    email = await fetchGoogleUserEmail({ accessToken: tokens.accessToken })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return redirectOauthError(c, msg)
  }
  const mailboxId = deriveMailboxId(email)
  const ripmailHome = ripmailHomeForBrain()
  try {
    await writeGoogleOAuthTokenFile(ripmailHome, mailboxId, tokens)
    await upsertRipmailConfig(ripmailHome, mailboxId, email)
    await upsertRipmailGoogleCalendarSource(ripmailHome, mailboxId, email)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return redirectOauthError(c, msg)
  }
  recordGoogleOauthSuccess()
  return c.redirect('/oauth/google/complete', 302)
})

export default app
