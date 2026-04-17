#!/usr/bin/env node
/**
 * Prints the canonical Gmail OAuth redirect URI (must match `googleOAuthRedirectUri()` in
 * src/server/lib/brainHttpPort.ts and Google Cloud Console).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function readPortFromNativeAppPort() {
  const raw = readFileSync(join(root, 'src/server/lib/nativeAppPort.ts'), 'utf8')
  const m = raw.match(/NATIVE_APP_PORT_START\s*=\s*(\d+)/)
  if (m) return parseInt(m[1], 10)
  return 18473
}

const port = readPortFromNativeAppPort()
console.log(`http://127.0.0.1:${port}/api/oauth/google/callback`)
