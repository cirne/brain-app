import { Hono, type Context } from 'hono'
import { googleOAuthRedirectUri } from '../lib/brainHttpPort.js'
import { ripmailHomeForBrain } from '../lib/brainHome.js'
import {
  buildGoogleAuthorizeUrl,
  deriveMailboxId,
  exchangeAuthorizationCode,
  fetchGoogleUserInfo,
  generatePkce,
  GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS,
  upsertRipmailConfig,
  upsertRipmailGoogleCalendarSource,
  writeGoogleOAuthTokenFile,
} from '../lib/googleOAuth.js'
import { isMultiTenantMode, tenantHomeDir } from '../lib/dataRoot.js'
import { resolveOrProvisionWorkspace } from '../lib/googleIdentityWorkspace.js'
import { createVaultSession } from '../lib/vaultSessionStore.js'
import { setBrainSessionCookie } from '../lib/vaultCookie.js'
import { registerSessionTenant } from '../lib/tenantRegistry.js'
import { runWithTenantContextAsync } from '../lib/tenantContext.js'
import {
  newOAuthState,
  putOAuthSession,
  takeOAuthVerifier,
} from '../lib/gmailOAuthState.js'
import {
  readOnboardingPreferences,
  saveOnboardingPreferences,
} from '../lib/onboardingPreferences.js'
import {
  recordGoogleOauthError,
  recordGoogleOauthSuccess,
  takeGoogleOauthDesktopResult,
} from '../lib/googleOauthDesktopResult.js'

const app = new Hono()

function getOAuthConfig(
  c: Context
): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return null
  }
  return { clientId, clientSecret, redirectUri: googleOAuthRedirectUri(c) }
}

function redirectOauthError(c: Context, message: string) {
  recordGoogleOauthError(message)
  const q = encodeURIComponent(message)
  return c.redirect(`/oauth/google/error?reason=${q}`, 302)
}

/** So onboarding “Getting to know you” copy matches Gmail, including flows that skip PATCH /preferences. */
async function persistGoogleMailProviderPreference(): Promise<void> {
  try {
    const prev = await readOnboardingPreferences()
    await saveOnboardingPreferences({ ...prev, mailProvider: 'google' })
  } catch (e) {
    console.error('[oauth/google] could not set onboarding mailProvider=google', e)
  }
}

app.get('/start', (c) => {
  const oauth = getOAuthConfig(c)
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
    scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS,
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
  const oauth = getOAuthConfig(c)
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
  let sub: string
  try {
    const u = await fetchGoogleUserInfo({ accessToken: tokens.accessToken })
    email = u.email
    sub = u.sub
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return redirectOauthError(c, msg)
  }

  if (isMultiTenantMode()) {
    const { tenantUserId, workspaceHandle } = await resolveOrProvisionWorkspace(sub, email)
    const homeDir = tenantHomeDir(tenantUserId)
    return runWithTenantContextAsync({ tenantUserId, workspaceHandle, homeDir }, async () => {
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
      await persistGoogleMailProviderPreference()
      const sessionId = await createVaultSession()
      await registerSessionTenant(sessionId, tenantUserId)
      setBrainSessionCookie(c, sessionId)
      recordGoogleOauthSuccess()
      return c.redirect('/oauth/google/complete', 302)
    })
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
  await persistGoogleMailProviderPreference()
  recordGoogleOauthSuccess()
  return c.redirect('/oauth/google/complete', 302)
})

export default app
