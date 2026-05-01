import { Hono, type Context } from 'hono'
import { googleOAuthRedirectUri } from '@server/lib/platform/brainHttpPort.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import {
  buildGoogleAuthorizeUrl,
  deriveMailboxId,
  exchangeAuthorizationCode,
  fetchGoogleUserInfo,
  generatePkce,
  GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
  upsertRipmailConfig,
  upsertRipmailGoogleCalendarSource,
  upsertRipmailGoogleDriveSource,
  validateGoogleOAuthGrantedScopes,
  writeGoogleOAuthTokenFile,
} from '@server/lib/platform/googleOAuth.js'
import { ensureSingleSourceMarkedAsDefaultSend } from '@server/lib/platform/ripmailConfigEdit.js'
import { isMultiTenantMode, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import {
  googleIdentityKey,
  resolveOrProvisionWorkspace,
} from '@server/lib/tenant/googleIdentityWorkspace.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { setBrainSessionCookie } from '@server/lib/vault/vaultCookie.js'
import {
  lookupTenantBySession,
  lookupWorkspaceByIdentity,
  registerSessionTenant,
} from '@server/lib/tenant/tenantRegistry.js'
import {
  runWithTenantContextAsync,
  tryGetTenantContext,
} from '@server/lib/tenant/tenantContext.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { ensureWikiVaultScaffold } from '@server/lib/wiki/wikiVaultScaffold.js'
import { BRAIN_SESSION_COOKIE } from '@server/lib/vault/vaultCookie.js'
import { getCookie } from 'hono/cookie'
import {
  findLinkedMailboxByEmail,
  findLinkedMailboxBySub,
  upsertLinkedMailbox,
} from '@server/lib/tenant/linkedMailboxes.js'
import {
  newOAuthState,
  putOAuthSession,
  takeOAuthVerifier,
} from '@server/lib/platform/gmailOAuthState.js'
import {
  readOnboardingPreferences,
  saveOnboardingPreferences,
} from '@server/lib/onboarding/onboardingPreferences.js'
import {
  recordGoogleOauthError,
  recordGoogleOauthSuccess,
  takeGoogleOauthDesktopResult,
} from '@server/lib/platform/googleOauthDesktopResult.js'

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

function redirectLinkError(c: Context, message: string) {
  recordGoogleOauthError(message)
  const q = encodeURIComponent(message)
  return c.redirect(`/settings?addAccountError=${q}`, 302)
}

function redirectLinkSuccess(c: Context, email: string) {
  recordGoogleOauthSuccess()
  const q = encodeURIComponent(email)
  return c.redirect(`/settings?addedAccount=${q}`, 302)
}

/**
 * Shared body for add-account OAuth: the registered Google redirect is always
 * `/api/oauth/google/callback`, so `mode: link` is completed from the main callback
 * and from the legacy `/link/callback` route (tests, optional second redirect URI).
 */
async function completeGmailLinkOAuth(
  c: Context,
  oauth: { clientId: string; clientSecret: string; redirectUri: string },
  code: string,
  codeVerifier: string,
): Promise<Response> {
  let tokens
  try {
    tokens = await exchangeAuthorizationCode({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      redirectUri: oauth.redirectUri,
      code,
      codeVerifier,
    })
  } catch (e) {
    return redirectLinkError(c, e instanceof Error ? e.message : String(e))
  }
  if (!tokens.refreshToken) {
    return redirectLinkError(
      c,
      'Google did not return a refresh token. Revoke Braintunnel access in your Google account and try linking again.',
    )
  }
  const scopeCheck = validateGoogleOAuthGrantedScopes(tokens.scope)
  if (!scopeCheck.ok) {
    return redirectLinkError(c, scopeCheck.message)
  }

  let email: string
  let sub: string
  try {
    const u = await fetchGoogleUserInfo({ accessToken: tokens.accessToken })
    email = u.email
    sub = u.sub
  } catch (e) {
    return redirectLinkError(c, e instanceof Error ? e.message : String(e))
  }

  if (isMultiTenantMode()) {
    const sid = getCookie(c, BRAIN_SESSION_COOKIE)
    const tenantUserId = await lookupTenantBySession(sid)
    if (!tenantUserId) {
      return redirectLinkError(
        c,
        'Your sign-in session expired. Sign in to Braintunnel again before linking.',
      )
    }

    const existingPrimaryTenant = await lookupWorkspaceByIdentity(googleIdentityKey(sub))
    if (existingPrimaryTenant && existingPrimaryTenant !== tenantUserId) {
      return redirectLinkError(
        c,
        `That Google account is the sign-in for a different Braintunnel workspace. Sign in with that account or use a different Gmail.`,
      )
    }

    const homeDir = tenantHomeDir(tenantUserId)
    const meta = await readHandleMeta(homeDir)
    const workspaceHandle = meta?.handle ?? tenantUserId
    return runWithTenantContextAsync({ tenantUserId, workspaceHandle, homeDir }, async () => {
      const ripmailHome = ripmailHomeForBrain()
      try {
        const existingByEmail = await findLinkedMailboxByEmail(email)
        const existingBySub = await findLinkedMailboxBySub(sub)
        if (existingByEmail || existingBySub) {
          await writeGoogleOAuthTokenFile(ripmailHome, deriveMailboxId(email), tokens)
          await upsertRipmailGoogleDriveSource(ripmailHome, deriveMailboxId(email), email)
        } else {
          const mailboxId = deriveMailboxId(email)
          await writeGoogleOAuthTokenFile(ripmailHome, mailboxId, tokens)
          await upsertRipmailConfig(ripmailHome, mailboxId, email)
          await upsertRipmailGoogleCalendarSource(ripmailHome, mailboxId, email)
          await upsertRipmailGoogleDriveSource(ripmailHome, mailboxId, email)
        }
        await upsertLinkedMailbox({ email, googleSub: sub })
        await ensureSingleSourceMarkedAsDefaultSend(ripmailHome)
      } catch (e) {
        return redirectLinkError(c, e instanceof Error ? e.message : String(e))
      }
      return redirectLinkSuccess(c, email)
    })
  }

  const ripmailHome = ripmailHomeForBrain()
  try {
    const existingByEmail = await findLinkedMailboxByEmail(email)
    const existingBySub = await findLinkedMailboxBySub(sub)
    if (existingByEmail || existingBySub) {
      await writeGoogleOAuthTokenFile(ripmailHome, deriveMailboxId(email), tokens)
      await upsertRipmailGoogleDriveSource(ripmailHome, deriveMailboxId(email), email)
    } else {
      const mailboxId = deriveMailboxId(email)
      await writeGoogleOAuthTokenFile(ripmailHome, mailboxId, tokens)
      await upsertRipmailConfig(ripmailHome, mailboxId, email)
      await upsertRipmailGoogleCalendarSource(ripmailHome, mailboxId, email)
      await upsertRipmailGoogleDriveSource(ripmailHome, mailboxId, email)
    }
    await upsertLinkedMailbox({ email, googleSub: sub })
    await ensureSingleSourceMarkedAsDefaultSend(ripmailHome)
  } catch (e) {
    return redirectLinkError(c, e instanceof Error ? e.message : String(e))
  }
  return redirectLinkSuccess(c, email)
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
    scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
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
  const session = takeOAuthVerifier(state)
  if (!session) {
    return redirectOauthError(
      c,
      'Sign-in session expired. Return to Braintunnel and use Connect Google again.'
    )
  }
  if (session.mode === 'link') {
    return completeGmailLinkOAuth(c, oauth, code, session.verifier)
  }
  if (session.mode !== 'signIn') {
    return redirectOauthError(
      c,
      'Unrecognized OAuth session mode. Return to Braintunnel and start again.',
    )
  }
  let tokens
  try {
    tokens = await exchangeAuthorizationCode({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      redirectUri: oauth.redirectUri,
      code,
      codeVerifier: session.verifier,
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
  const scopeCheck = validateGoogleOAuthGrantedScopes(tokens.scope)
  if (!scopeCheck.ok) {
    return redirectOauthError(c, scopeCheck.message)
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
    const { tenantUserId, workspaceHandle, isNew } = await resolveOrProvisionWorkspace(sub, email)
    const homeDir = tenantHomeDir(tenantUserId)
    return runWithTenantContextAsync({ tenantUserId, workspaceHandle, homeDir }, async () => {
      if (isNew) {
        try {
          await ensureWikiVaultScaffold(wikiDir())
        } catch (e) {
          console.error('[oauth/google/callback] ensureWikiVaultScaffold:', e)
        }
      }
      const mailboxId = deriveMailboxId(email)
      const ripmailHome = ripmailHomeForBrain()
      try {
        await writeGoogleOAuthTokenFile(ripmailHome, mailboxId, tokens)
        await upsertRipmailConfig(ripmailHome, mailboxId, email)
        await upsertRipmailGoogleCalendarSource(ripmailHome, mailboxId, email)
        await upsertRipmailGoogleDriveSource(ripmailHome, mailboxId, email)
        await upsertLinkedMailbox({ email, googleSub: sub, isPrimary: true })
        await ensureSingleSourceMarkedAsDefaultSend(ripmailHome)
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
    await upsertRipmailGoogleDriveSource(ripmailHome, mailboxId, email)
    await upsertLinkedMailbox({ email, googleSub: sub, isPrimary: true })
    await ensureSingleSourceMarkedAsDefaultSend(ripmailHome)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return redirectOauthError(c, msg)
  }
  await persistGoogleMailProviderPreference()
  recordGoogleOauthSuccess()
  return c.redirect('/oauth/google/complete', 302)
})

/* ──────────────────────────────────────────────────────────────────────────
 * Add-account ("link") flow — OPP-044 phase 1.
 *
 * `/link/start` requires a valid Brain session (signed-in user) and kicks off the same Google
 * consent screen as primary sign-in. Google returns to the same registered URI as sign-in
 * (`/api/oauth/google/callback`); the handler runs `completeGmailLinkOAuth` when
 * `mode === 'link'`. The legacy `/link/callback` route reuses the same implementation.
 * The new IMAP source is written onto the existing tenant instead of provisioning a workspace. This keeps
 * "one Braintunnel handle, many Gmail accounts" possible without touching the
 * `tenant-registry.json` `identities` map (which is reserved for sign-in identities).
 *
 * In single-tenant (desktop) mode we still rely on a vault session. The vault gate normally
 * protects `/api/*`, but `/api/oauth/google/*` is allowlisted in the multi-tenant middleware so
 * sign-in can run without a session. For link routes we re-check the session ourselves via
 * `requireBrainSession`.
 * ────────────────────────────────────────────────────────────────────────── */

async function requireBrainSession(c: Context): Promise<boolean> {
  if (!isMultiTenantMode()) {
    return true
  }
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const tenantUserId = await lookupTenantBySession(sid)
  return !!tenantUserId
}

app.get('/link/start', async (c) => {
  const oauth = getOAuthConfig(c)
  if (!oauth) {
    return redirectOauthError(
      c,
      'Gmail connection is not configured (missing Google OAuth client credentials).',
    )
  }
  if (!(await requireBrainSession(c))) {
    return redirectOauthError(c, 'Sign in to Braintunnel before adding another Gmail account.')
  }
  const { verifier, challenge } = generatePkce()
  const state = newOAuthState()
  putOAuthSession(state, verifier, { mode: 'link' })
  const url = buildGoogleAuthorizeUrl({
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    scope: GOOGLE_OAUTH_SCOPE_MAIL_OPENID_EMAIL_CALENDAR_EVENTS_DRIVE,
    state,
    codeChallenge: challenge,
  })
  return c.redirect(url)
})

app.get('/link/callback', async (c) => {
  const oauth = getOAuthConfig(c)
  if (!oauth) {
    return redirectLinkError(
      c,
      'Gmail connection is not configured (missing Google OAuth client credentials).',
    )
  }
  const providerErr = c.req.query('error')
  const providerDesc = c.req.query('error_description')
  if (providerErr) {
    return redirectLinkError(c, providerDesc ? `${providerErr}: ${providerDesc}` : providerErr)
  }
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return redirectLinkError(
      c,
      'Missing code or state from Google. Return to Braintunnel and try again.',
    )
  }
  const session = takeOAuthVerifier(state)
  if (!session || session.mode !== 'link') {
    return redirectLinkError(
      c,
      'This add-account link expired. Return to the Hub and start again.',
    )
  }

  return completeGmailLinkOAuth(c, oauth, code, session.verifier)
})

/** GET /api/oauth/google/linked — list linked Gmail accounts for the current tenant. */
app.get('/linked', async (c) => {
  if (isMultiTenantMode()) {
    if (!tryGetTenantContext()) {
      return c.json({ error: 'tenant_required', message: 'Sign in to Braintunnel.' }, 401)
    }
  }
  const { readLinkedMailboxes } = await import('@server/lib/tenant/linkedMailboxes.js')
  const doc = await readLinkedMailboxes()
  return c.json({
    mailboxes: doc.mailboxes.map((m) => ({
      email: m.email,
      linkedAt: m.linkedAt,
      isPrimary: m.isPrimary === true,
    })),
  })
})

export default app
