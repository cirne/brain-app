import { isBundledNativeServer, NATIVE_APP_PORT_START } from './nativeAppPort.js'

/**
 * Default HTTP listen port for **dev** and **non-bundled** production (`node dist/server` without
 * `BRAIN_BUNDLED_NATIVE`). Keeps `npm run dev` off **18473**, which the packaged Brain.app reserves
 * for its embedded server + OAuth.
 *
 * The **bundled** Tauri app listens on {@link NATIVE_APP_PORT_START} (18473); OAuth redirect for
 * that mode uses the same port (see {@link oauthRedirectListenPort}).
 */
export const BRAIN_DEFAULT_HTTP_PORT = 3000

/** Path segment for Gmail OAuth callback (mounted under `/api/oauth/google` in Hono). */
export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/oauth/google/callback'

/**
 * Port embedded in the Google OAuth redirect URI. Must match the URL the browser is sent to after
 * consent — i.e. the TCP port Brain is listening on for this process (or 18473 when `BRAIN_BUNDLED_NATIVE=1`).
 */
export function oauthRedirectListenPort(): number {
  if (isBundledNativeServer()) return NATIVE_APP_PORT_START
  return parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)
}

/**
 * Redirect URI for Google OAuth (must match Authorized redirect URIs on the OAuth client).
 * Register **both** dev (`:3000` by default) and bundled (`:18473`) URIs in Google Cloud Console.
 * Uses loopback IP so it matches a single registered entry per port regardless of `localhost` DNS.
 */
export function googleOAuthRedirectUri(): string {
  return `http://127.0.0.1:${oauthRedirectListenPort()}${GOOGLE_OAUTH_CALLBACK_PATH}`
}
