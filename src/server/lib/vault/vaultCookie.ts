import type { Context } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'

export const BRAIN_SESSION_COOKIE = 'brain_session'

/** Session cookie max-age (seconds), aligned with {@link VAULT_SESSION_TTL_MS}. */
export const BRAIN_SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60

export function isSecureRequest(c: Context): boolean {
  const url = new URL(c.req.url)
  if (url.protocol === 'https:') return true
  const xf = c.req.header('x-forwarded-proto')
  return xf === 'https'
}

export function setBrainSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, BRAIN_SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    maxAge: BRAIN_SESSION_MAX_AGE_SEC,
  })
}

export function clearBrainSessionCookie(c: Context): void {
  deleteCookie(c, BRAIN_SESSION_COOKIE, {
    path: '/',
    secure: isSecureRequest(c),
    sameSite: 'Lax',
  })
}
