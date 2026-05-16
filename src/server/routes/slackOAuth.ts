import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { slackOAuthRedirectUri } from '@server/lib/platform/brainHttpPort.js'
import {
  buildSlackAuthorizeUrl,
  exchangeSlackAuthorizationCode,
  fetchSlackOpenIdUserInfo,
  parseSlackOAuthAccess,
} from '@server/lib/platform/slackOAuth.js'
import {
  newSlackOAuthState,
  putSlackOAuthSession,
  takeSlackOAuthSession,
} from '@server/lib/platform/slackOAuthState.js'
import {
  getSlackWorkspace,
  isSlackOAuthConfigured,
  upsertSlackUserLink,
  upsertSlackWorkspace,
} from '@server/lib/slack/slackConnectionsRepo.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readLinkedMailboxesFor } from '@server/lib/tenant/linkedMailboxes.js'
import { lookupTenantBySession } from '@server/lib/tenant/tenantRegistry.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { BRAIN_SESSION_COOKIE } from '@server/lib/vault/vaultCookie.js'

const app = new Hono()

function getOAuthConfig(c: Context): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.SLACK_CLIENT_ID?.trim()
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, redirectUri: slackOAuthRedirectUri(c) }
}

function redirectSlackError(c: Context, message: string, queryKey = 'slackError') {
  const q = encodeURIComponent(message)
  return c.redirect(`/settings?${queryKey}=${q}`, 302)
}

function redirectSlackSuccess(c: Context, queryKey: string) {
  return c.redirect(`/settings?${queryKey}=1`, 302)
}

async function tenantEmailsForMatch(tenantUserId: string): Promise<Set<string>> {
  const emails = new Set<string>()
  const homeDir = tenantHomeDir(tenantUserId)
  const linked = await readLinkedMailboxesFor(homeDir)
  for (const m of linked.mailboxes) {
    if (m.email) emails.add(m.email.trim().toLowerCase())
  }
  return emails
}

function parseMode(raw: string | undefined): 'install' | 'link' | null {
  if (raw === 'install' || raw === 'link') return raw
  return null
}

app.get('/start', async (c) => {
  if (!isSlackOAuthConfigured()) {
    return redirectSlackError(c, 'Slack connection is not configured (missing Slack OAuth credentials).')
  }
  const oauth = getOAuthConfig(c)
  if (!oauth) {
    return redirectSlackError(c, 'Slack connection is not configured (missing Slack OAuth credentials).')
  }
  const mode = parseMode(c.req.query('mode'))
  if (!mode) {
    return redirectSlackError(c, 'Invalid Slack connection mode. Use install or link.')
  }
  const ctx = tryGetTenantContext()
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const tenantUserId = ctx?.tenantUserId ?? (await lookupTenantBySession(sid))
  if (!tenantUserId) {
    return redirectSlackError(c, 'Sign in to Braintunnel before connecting Slack.')
  }
  const state = newSlackOAuthState()
  putSlackOAuthSession(state, tenantUserId, mode)
  const url = buildSlackAuthorizeUrl({
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    state,
    mode,
  })
  return c.redirect(url, 302)
})

app.get('/callback', async (c) => {
  if (!isSlackOAuthConfigured()) {
    return redirectSlackError(c, 'Slack connection is not configured (missing Slack OAuth credentials).')
  }
  const oauth = getOAuthConfig(c)
  if (!oauth) {
    return redirectSlackError(c, 'Slack connection is not configured (missing Slack OAuth credentials).')
  }
  const providerErr = c.req.query('error')
  if (providerErr) {
    const desc = c.req.query('error_description')
    const msg = desc ? `${providerErr}: ${desc}` : providerErr
    return redirectSlackError(c, msg)
  }
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) {
    return redirectSlackError(c, 'Missing code or state from Slack. Try connecting again from Settings.')
  }
  const session = takeSlackOAuthSession(state)
  if (!session) {
    return redirectSlackError(c, 'Slack sign-in session expired. Start Connect Slack again from Settings.')
  }
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const activeTenant = await lookupTenantBySession(sid)
  if (!activeTenant || activeTenant !== session.tenantUserId) {
    return redirectSlackError(
      c,
      'Your Braintunnel session changed during Slack authorization. Sign in and try again.',
    )
  }

  let data
  try {
    data = await exchangeSlackAuthorizationCode({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      redirectUri: oauth.redirectUri,
      code,
    })
  } catch (e) {
    return redirectSlackError(c, e instanceof Error ? e.message : String(e))
  }
  if (!data.ok) {
    return redirectSlackError(c, data.error ?? 'Slack authorization failed.')
  }

  const parsed = parseSlackOAuthAccess(data)
  if (!parsed.teamId) {
    return redirectSlackError(c, 'Slack did not return a workspace. Try again from Settings.')
  }

  if (session.mode === 'install') {
    if (!parsed.botToken) {
      return redirectSlackError(c, 'Slack did not return a bot token. Reinstall the app to this workspace.')
    }
    upsertSlackWorkspace({
      slackTeamId: parsed.teamId,
      teamName: parsed.teamName ?? parsed.teamId,
      installerTenantUserId: session.tenantUserId,
      botToken: parsed.botToken,
    })
    return redirectSlackSuccess(c, 'slackConnected')
  }

  const workspace = getSlackWorkspace(parsed.teamId)
  if (!workspace) {
    return redirectSlackError(
      c,
      'This Slack workspace is not connected to Braintunnel yet. Ask your admin to connect the workspace first.',
    )
  }
  if (!parsed.slackUserId) {
    return redirectSlackError(c, 'Slack did not return your user id. Try linking again.')
  }

  let slackEmail: string | null = null
  if (parsed.userAccessToken) {
    try {
      const info = await fetchSlackOpenIdUserInfo(parsed.userAccessToken)
      if (typeof info.email === 'string' && info.email.trim()) {
        slackEmail = info.email.trim().toLowerCase()
      }
    } catch {
      /* email optional for link if we cannot fetch */
    }
  }

  if (slackEmail) {
    const allowed = await tenantEmailsForMatch(session.tenantUserId)
    if (!allowed.has(slackEmail)) {
      // Email mismatch — offer a confirm step instead of hard-rejecting
      const confirmState = newSlackOAuthState()
      putSlackOAuthSession(confirmState, session.tenantUserId, 'link-confirm')
      const confirmParams = new URLSearchParams({
        slackLinkConfirm: '1',
        slackEmail,
        slackTeamId: parsed.teamId,
        slackUserId: parsed.slackUserId,
        confirmState,
      })
      return c.redirect(`/settings?${confirmParams.toString()}`, 302)
    }
  }

  upsertSlackUserLink({
    slackTeamId: parsed.teamId,
    slackUserId: parsed.slackUserId,
    tenantUserId: session.tenantUserId,
    slackEmail,
  })
  return redirectSlackSuccess(c, 'slackLinked')
})

/**
 * POST /api/slack/oauth/link-confirm
 *
 * Vault-gated: consumes the one-time confirm state token produced when
 * the Slack email doesn't match a linked Braintunnel mailbox, and writes
 * the user link with a null email (explicitly confirmed by the user).
 */
app.post('/link-confirm', async (c) => {
  if (!isSlackOAuthConfigured()) {
    return c.json({ error: 'slack_not_configured' }, 503)
  }
  let body: { confirmState?: unknown; slackTeamId?: unknown; slackUserId?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const confirmState = typeof body.confirmState === 'string' ? body.confirmState.trim() : ''
  const slackTeamId = typeof body.slackTeamId === 'string' ? body.slackTeamId.trim() : ''
  const slackUserId = typeof body.slackUserId === 'string' ? body.slackUserId.trim() : ''
  if (!confirmState || !slackTeamId || !slackUserId) {
    return c.json({ error: 'missing_fields' }, 400)
  }

  const oauthSession = takeSlackOAuthSession(confirmState)
  if (!oauthSession || oauthSession.mode !== 'link-confirm') {
    return c.json({ error: 'confirm_state_invalid_or_expired' }, 400)
  }

  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const activeTenant = await lookupTenantBySession(sid)
  if (!activeTenant || activeTenant !== oauthSession.tenantUserId) {
    return c.json({ error: 'session_mismatch' }, 403)
  }

  const workspace = getSlackWorkspace(slackTeamId)
  if (!workspace) {
    return c.json({ error: 'workspace_not_found' }, 404)
  }

  upsertSlackUserLink({
    slackTeamId,
    slackUserId,
    tenantUserId: oauthSession.tenantUserId,
    slackEmail: null,
  })
  return c.json({ ok: true })
})

export default app
