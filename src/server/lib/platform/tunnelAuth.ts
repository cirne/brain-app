/**
 * Named Cloudflare tunnel (“magic GUID”) gate shared by Hono and the dev Node/Vite server entrypoint.
 */

import { getHostGuid, tunnelGateHostname } from './tunnelManager.js'

export { tunnelGateHostname }

export const BRAIN_TUNNEL_COOKIE_NAME = 'brain_g'
export const BRAIN_TUNNEL_COOKIE_MAX_AGE_SEC = 31536000

export function buildBrainTunnelGuidCookie(guid: string): string {
  return `${BRAIN_TUNNEL_COOKIE_NAME}=${guid}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${BRAIN_TUNNEL_COOKIE_MAX_AGE_SEC}`
}

export function parseBrainTunnelCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined
  const re = new RegExp(`(?:^|;\\s*)${BRAIN_TUNNEL_COOKIE_NAME}=([^;]+)`)
  const m = cookieHeader.match(re)
  const v = m?.[1]?.trim()
  return v && v.length > 0 ? v : undefined
}

export type NamedTunnelGuidDecision =
  | { action: 'passthrough' }
  | { action: 'allow' }
  /** Query `g` matched: caller must set {@link buildBrainTunnelGuidCookie}; optional HTML redirect strips `g`. */
  | { action: 'allow_set_cookie'; redirectLocation?: string }
  | { action: 'deny' }

function stripQueryParamG(requestUrl: string): string | undefined {
  try {
    const u = new URL(requestUrl)
    u.searchParams.delete('g')
    return u.toString()
  } catch {
    return undefined
  }
}

export function decideNamedTunnelGuidAccess(input: {
  tunnelActive: boolean
  hostHeader: string | undefined
  pathname: string
  /** Absolute or relative URL string used only to build redirect Location when stripping `g`. */
  requestUrl: string
  acceptHeader: string | undefined
  queryParamG: string | null | undefined
  cookieBrainG: string | undefined | null
  expectedGuid: string
}): NamedTunnelGuidDecision {
  if (!input.tunnelActive) return { action: 'passthrough' }
  const host = input.hostHeader ?? ''
  if (!host.includes(tunnelGateHostname())) return { action: 'passthrough' }

  // Slack Events API / interactivity — verified via signing secret, not magic GUID.
  if (input.pathname.startsWith('/api/slack/')) {
    return { action: 'passthrough' }
  }

  const q = input.queryParamG ?? null
  if (q === input.expectedGuid) {
    const redirect =
      input.acceptHeader?.includes('text/html') === true && !input.pathname.startsWith('/api/')
        ? stripQueryParamG(input.requestUrl)
        : undefined
    return { action: 'allow_set_cookie', redirectLocation: redirect }
  }
  if (input.cookieBrainG === input.expectedGuid) return { action: 'allow' }
  return { action: 'deny' }
}

export function expectedTunnelHostGuid(): string {
  return getHostGuid()
}
