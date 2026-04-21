import type { Context } from 'hono'
import { isBundledNativeServer, NATIVE_APP_PORT_START } from './nativeAppPort.js'

/** Bundled Brain.app serves the embedded Hono server over HTTPS (self-signed cert; OPP-023). */
export const BUNDLED_EMBEDDED_SERVER_SCHEME = 'https' as const
export const NON_BUNDLED_EMBEDDED_SERVER_SCHEME = 'http' as const

/**
 * Default HTTP listen port for **dev** and **non-bundled** production (`node dist/server` without
 * `BRAIN_BUNDLED_NATIVE`). Keeps `npm run dev` off **18473**, which the packaged Brain.app reserves
 * for its embedded server + OAuth.
 *
 * The **bundled** Tauri app dynamically binds the first available port starting at
 * {@link NATIVE_APP_PORT_START} (18473); the actual bound port is stored via
 * {@link setActualNativePort} so {@link oauthRedirectListenPort} returns the correct value.
 */
export const BRAIN_DEFAULT_HTTP_PORT = 3000

/** Path segment for Gmail OAuth callback (mounted under `/api/oauth/google` in Hono). */
export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/oauth/google/callback'

/**
 * The port the bundled native server actually bound to. Set once at startup by
 * {@link setActualNativePort}; read by {@link oauthRedirectListenPort} at request time so the
 * OAuth redirect URI always reflects the live port.
 */
let _actualNativePort: number = NATIVE_APP_PORT_START

/** Called once from `listenNativeBundled()` after the server successfully binds. */
export function setActualNativePort(port: number): void {
  _actualNativePort = port
}

/**
 * Port embedded in the Google OAuth redirect URI. Must match the URL the browser is sent to after
 * consent — i.e. the TCP port Brain is listening on for this process.
 *
 * In bundled native mode the port is determined dynamically at startup (first available from the
 * OAuth candidate list); in dev/non-bundled mode it comes from `PORT` env or the default 3000.
 */
export function oauthRedirectListenPort(): number {
  if (isBundledNativeServer()) return _actualNativePort
  return parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)
}

/**
 * Redirect URI for Google OAuth (must match Authorized redirect URIs on the OAuth client).
 * Register **both** dev (`:3000` by default) and bundled (`:18473`) URIs in Google Cloud Console.
 * Uses loopback IP so it matches a single registered entry per port regardless of `localhost` DNS.
 */
export function embeddedServerUrlScheme():
  | typeof BUNDLED_EMBEDDED_SERVER_SCHEME
  | typeof NON_BUNDLED_EMBEDDED_SERVER_SCHEME {
  return isBundledNativeServer() ? BUNDLED_EMBEDDED_SERVER_SCHEME : NON_BUNDLED_EMBEDDED_SERVER_SCHEME
}

/**
 * When set (non-bundled only), Gmail OAuth redirect uses this origin so the browser returns to the
 * **same host** as the SPA (avoids `localhost` vs `127.0.0.1` cookie / session split). Example:
 * `http://localhost:4000` for Docker Compose. Must match an entry in Google Cloud redirect URIs.
 *
 * **Production without `PUBLIC_WEB_ORIGIN`:** when `NODE_ENV === 'production'`, the handler may pass
 * `c` so we infer `https://host` from `X-Forwarded-Proto` / `X-Forwarded-Host` / `Host` (DigitalOcean
 * App Platform, etc.). Prefer setting `PUBLIC_WEB_ORIGIN` explicitly for stability.
 */
function inferPublicOriginFromForwardedHeaders(c: Context): string | null {
  if (process.env.NODE_ENV !== 'production') return null
  if (isBundledNativeServer()) return null
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
  if (isBundledNativeServer()) {
    const scheme = embeddedServerUrlScheme()
    return `${scheme}://127.0.0.1:${oauthRedirectListenPort()}${GOOGLE_OAUTH_CALLBACK_PATH}`
  }
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
