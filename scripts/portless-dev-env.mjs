#!/usr/bin/env node
/**
 * Sets PUBLIC_WEB_ORIGIN for Gmail OAuth when running behind portless (if unset).
 * Portless assigns PORT; the browser should use the stable .localhost HTTPS URL.
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const portlessCli = join(repoRoot, 'node_modules/portless/dist/cli.js')

/** @param {string} name */
function tryPortlessGet(name) {
  try {
    const url = execFileSync(process.execPath, [portlessCli, 'get', name], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return url && /^https?:\/\//.test(url) ? url.replace(/\/$/, '') : null
  } catch {
    return null
  }
}

/**
 * @param {string} [configuredName]
 */
export function applyPortlessPublicWebOrigin(configuredName = 'braintunnel') {
  if (process.env.PUBLIC_WEB_ORIGIN?.trim()) return

  const fromEnv = process.env.PORTLESS_URL?.trim() || process.env.PORTLESS_PUBLIC_URL?.trim()
  if (fromEnv && /^https?:\/\//.test(fromEnv)) {
    process.env.PUBLIC_WEB_ORIGIN = fromEnv.replace(/\/$/, '')
    return
  }

  const fromGet = tryPortlessGet(configuredName)
  if (fromGet) {
    process.env.PUBLIC_WEB_ORIGIN = fromGet
  }
}
