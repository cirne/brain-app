import { Hono } from 'hono'
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

const app = new Hono()

function getOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return null
  }
  return { clientId, clientSecret, redirectUri: googleOAuthRedirectUri() }
}

app.get('/start', (c) => {
  const oauth = getOAuthConfig()
  if (!oauth) {
    return c.redirect('/?gmailError=oauth_not_configured')
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

app.get('/callback', async (c) => {
  const oauth = getOAuthConfig()
  if (!oauth) {
    return c.redirect('/?gmailError=oauth_not_configured')
  }
  const providerErr = c.req.query('error')
  const providerDesc = c.req.query('error_description')
  if (providerErr) {
    const msg = encodeURIComponent(
      providerDesc ? `${providerErr}: ${providerDesc}` : providerErr
    )
    return c.redirect(`/?gmailError=${msg}`)
  }
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return c.redirect('/?gmailError=missing_code_or_state')
  }
  const verifier = takeOAuthVerifier(state)
  if (!verifier) {
    return c.redirect('/?gmailError=invalid_or_expired_state')
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
    const msg = encodeURIComponent(e instanceof Error ? e.message : String(e))
    return c.redirect(`/?gmailError=${msg}`)
  }
  if (!tokens.refreshToken) {
    return c.redirect(
      `/?gmailError=${encodeURIComponent(
        'No refresh token — revoke Brain access in Google Account and connect again'
      )}`
    )
  }
  let email: string
  try {
    email = await fetchGoogleUserEmail({ accessToken: tokens.accessToken })
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : String(e))
    return c.redirect(`/?gmailError=${msg}`)
  }
  const mailboxId = deriveMailboxId(email)
  const ripmailHome = ripmailHomeForBrain()
  try {
    await writeGoogleOAuthTokenFile(ripmailHome, mailboxId, tokens)
    await upsertRipmailConfig(ripmailHome, mailboxId, email)
    await upsertRipmailGoogleCalendarSource(ripmailHome, mailboxId, email)
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : String(e))
    return c.redirect(`/?gmailError=${msg}`)
  }
  return c.redirect('/?gmailConnected=1')
})

export default app
