import { readFileSync } from 'node:fs'

/**
 * Load `.env` from cwd into `process.env` (only sets keys when value is non-empty).
 * Intended to match startup behavior in the main server entry.
 */
/** Keys set by the Tauri launcher for the bundled Node server — must not be replaced by cwd `.env`. */
const BUNDLED_NATIVE_SKIP_KEYS = new Set([
  'RIPMAIL_BIN',
  'RIPMAIL_HOME',
  'BRAIN_HOME',
  'BRAIN_WIKI_ROOT',
])

export function loadDotEnv(): void {
  try {
    const envContent = readFileSync('.env', 'utf-8')
    const bundledNative = process.env.BRAIN_BUNDLED_NATIVE === '1'
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        if (bundledNative && BUNDLED_NATIVE_SKIP_KEYS.has(key)) {
          continue
        }
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
        if (val) process.env[key] = val
      }
    }
  } catch {
    /* no .env file */
  }
}
