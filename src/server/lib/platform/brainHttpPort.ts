import type { Context } from 'hono'
import { isDevRuntime } from '@server/lib/platform/isDevRuntime.js'

export const NON_BUNDLED_EMBEDDED_SERVER_SCHEME = 'http' as const

/**
 * Default HTTP listen port for dev and production (`node dist/server`).
 */
export const BRAIN_DEFAULT_HTTP_PORT = 3000

/** Path segment for Gmail OAuth callback (mounted under `/api/oauth/google` in Hono). */
export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/oauth/google/callback'

/** Slack OAuth callback (mounted under `/api/slack/oauth` in Hono). */
export const SLACK_OAUTH_CALLBACK_PATH = '/api/slack/oauth/callback'

/**
 * Port embedded in the Google OAuth redirect URI. Must match the URL the browser uses after consent.
 */
export function oauthRedirectListenPort(): number {
  return parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)
}

export function embeddedServerUrlScheme(): typeof NON_BUNDLED_EMBEDDED_SERVER_SCHEME {
  return NON_BUNDLED_EMBEDDED_SERVER_SCHEME
}

/**
 * When set, Gmail OAuth redirect uses this origin so the browser returns to the same host as the SPA.
 */
function inferPublicOriginFromForwardedHeaders(c: Context): string | null {
  if (isDevRuntime()) return null
  const proto = c.req
    .header('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase()
  const host =
    c.req
      .header('x-forwarded-host')
      ?.split(',')[0]
      ?.trim() ||
    c.req.header('host')?.split(',')[0]?.trim() ||
    ''
  if (!host || (proto !== 'https' && proto !== 'http')) return null
  const h = host.toLowerCase()
  if (h.startsWith('127.0.0.1') || h.startsWith('localhost') || h.startsWith('0.0.0.0')) {
    return null
  }
  return `${proto}://${host}`
}

export function googleOAuthRedirectUri(c?: Context): string {
  const publicOrigin = process.env.PUBLIC_WEB_ORIGIN?.trim().replace(/\/$/, '')
  if (publicOrigin) {
    return `${publicOrigin}${GOOGLE_OAUTH_CALLBACK_PATH}`
  }
  if (c) {
    const inferred = inferPublicOriginFromForwardedHeaders(c)
    if (inferred) {
      return `${inferred}${GOOGLE_OAUTH_CALLBACK_PATH}`
    }
  }
  const scheme = NON_BUNDLED_EMBEDDED_SERVER_SCHEME
  return `${scheme}://127.0.0.1:${oauthRedirectListenPort()}${GOOGLE_OAUTH_CALLBACK_PATH}`
}

function slackOAuthOrigin(c?: Context): string {
  const publicOrigin = process.env.PUBLIC_WEB_ORIGIN?.trim().replace(/\/$/, '')
  if (publicOrigin) return publicOrigin
  if (c) {
    const inferred = inferPublicOriginFromForwardedHeaders(c)
    if (inferred) return inferred
  }
  const scheme = NON_BUNDLED_EMBEDDED_SERVER_SCHEME
  return `${scheme}://127.0.0.1:${oauthRedirectListenPort()}`
}

export function slackOAuthRedirectUri(c?: Context): string {
  return `${slackOAuthOrigin(c)}${SLACK_OAUTH_CALLBACK_PATH}`
}
