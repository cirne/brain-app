#!/usr/bin/env node
/**
 * Prints Gmail OAuth redirect URIs (must match `googleOAuthRedirectUri()` in
 * src/server/lib/brainHttpPort.ts and Google Cloud Console).
 *
 * Register in Authorized redirect URIs: dev uses :3000 (http); Braintunnel.app uses :18473+ (https).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function readPortFromFile(relPath, constName) {
  const raw = readFileSync(join(root, relPath), 'utf8')
  const re = new RegExp(`${constName}\\s*=\\s*(\\d+)`)
  const m = raw.match(re)
  if (m) return parseInt(m[1], 10)
  return null
}

const devDefault = readPortFromFile('src/server/lib/brainHttpPort.ts', 'BRAIN_DEFAULT_HTTP_PORT')
const bundled = readPortFromFile('src/server/lib/nativeAppPort.ts', 'NATIVE_APP_PORT_START')
const path = '/api/oauth/google/callback'

const devPort = devDefault ?? 3000
const nativePort = bundled ?? 18473

console.log(`Dev / npm run dev (default PORT): http://127.0.0.1:${devPort}${path}`)
console.log(
  `With PUBLIC_WEB_ORIGIN (e.g. Docker):  \${PUBLIC_WEB_ORIGIN}/api/oauth/google/callback`,
)
console.log(`Braintunnel.app (bundled server): https://127.0.0.1:${nativePort}${path}`)
