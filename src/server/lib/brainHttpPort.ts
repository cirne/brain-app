import { NATIVE_APP_PORT_START } from './nativeAppPort.js'

/**
 * Default HTTP listen port for Brain (dev, production `node dist/server`, bundled native).
 * Same as `NATIVE_APP_PORT_START` / desktop `tauri.conf.json` `frontendDist` — do not change casually;
 * Google OAuth redirect URI is registered for this port.
 */
export const BRAIN_DEFAULT_HTTP_PORT = NATIVE_APP_PORT_START

/** Path segment for Gmail OAuth callback (mounted under `/api/oauth/google` in Hono). */
export const GOOGLE_OAUTH_CALLBACK_PATH = '/api/oauth/google/callback'

/**
 * Fixed redirect URI for Google OAuth (must match Authorized redirect URIs on the OAuth client).
 * Uses loopback IP so it matches a single registered entry regardless of `localhost` DNS.
 */
export function googleOAuthRedirectUri(): string {
  return `http://127.0.0.1:${BRAIN_DEFAULT_HTTP_PORT}${GOOGLE_OAUTH_CALLBACK_PATH}`
}
