/** Slack OAuth v2 install + user identity (OPP-117). */

const SLACK_AUTHORIZE = 'https://slack.com/oauth/v2/authorize'
const SLACK_ACCESS = 'https://slack.com/api/oauth.v2.access'
const SLACK_OPENID_USERINFO = 'https://slack.com/api/openid.connect.userInfo'

/** Bot scopes for workspace install (hello-world + users.info). */
export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'chat:write',
  'im:history',
  'im:write',
  'users:read',
] as const

/** User scopes for account link (email match). */
export const SLACK_USER_SCOPES = ['openid', 'email'] as const

export type SlackOAuthAccessResponse = {
  ok: boolean
  error?: string
  access_token?: string
  team?: { id?: string; name?: string }
  authed_user?: {
    id?: string
    access_token?: string
    scope?: string
    token_type?: string
  }
}

export type SlackOpenIdUserInfo = {
  ok?: boolean
  error?: string
  sub?: string
  email?: string
  name?: string
}

export function buildSlackAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  mode: 'install' | 'link'
}): string {
  const u = new URL(SLACK_AUTHORIZE)
  u.searchParams.set('client_id', params.clientId)
  u.searchParams.set('redirect_uri', params.redirectUri)
  u.searchParams.set('state', params.state)
  if (params.mode === 'install') {
    u.searchParams.set('scope', SLACK_BOT_SCOPES.join(','))
  } else {
    u.searchParams.set('user_scope', SLACK_USER_SCOPES.join(','))
  }
  return u.toString()
}

export async function exchangeSlackAuthorizationCode(params: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}): Promise<SlackOAuthAccessResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  })
  const res = await fetch(SLACK_ACCESS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json()) as SlackOAuthAccessResponse
  if (!res.ok && !json.error) {
    throw new Error(`Slack token exchange failed (${res.status})`)
  }
  return json
}

export async function fetchSlackOpenIdUserInfo(accessToken: string): Promise<SlackOpenIdUserInfo> {
  const res = await fetch(SLACK_OPENID_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const json = (await res.json()) as SlackOpenIdUserInfo
  if (!res.ok && !json.error) {
    throw new Error(`Slack userinfo failed (${res.status})`)
  }
  return json
}

export function parseSlackOAuthAccess(data: SlackOAuthAccessResponse): {
  botToken: string | null
  teamId: string | null
  teamName: string | null
  slackUserId: string | null
  userAccessToken: string | null
} {
  const botToken =
    typeof data.access_token === 'string' && data.access_token.trim()
      ? data.access_token.trim()
      : null
  const teamId =
    typeof data.team?.id === 'string' && data.team.id.trim() ? data.team.id.trim() : null
  const teamName =
    typeof data.team?.name === 'string' && data.team.name.trim() ? data.team.name.trim() : null
  const slackUserId =
    typeof data.authed_user?.id === 'string' && data.authed_user.id.trim()
      ? data.authed_user.id.trim()
      : null
  const userAccessToken =
    typeof data.authed_user?.access_token === 'string' && data.authed_user.access_token.trim()
      ? data.authed_user.access_token.trim()
      : null
  return { botToken, teamId, teamName, slackUserId, userAccessToken }
}
