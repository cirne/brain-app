import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { BRAIN_SESSION_COOKIE } from './vaultCookie.js'

/**
 * Vault gate reads `brain_session` from the inbound Cookie header. Middleware that mints a new
 * session and calls `setBrainSessionCookie` does not mutate the inbound header, so downstream
 * `getCookie` stays empty unless we stash the sid for this request only (WeakMap keyed by Context).
 */
const sameRequestAck = new WeakMap<Context, string>()

export function setVaultSessionSameRequestAck(c: Context, sessionId: string): void {
  sameRequestAck.set(c, sessionId)
}

/** Cookie-based session id, or one minted earlier in this same request pipeline. */
export function getInboundOrAckedBrainSessionId(c: Context): string | undefined {
  const fromCookie = getCookie(c, BRAIN_SESSION_COOKIE)
  return fromCookie ?? sameRequestAck.get(c)
}
