import { readFileSync } from 'node:fs'

/**
 * Load `.env` from cwd into `process.env` (only sets keys when value is non-empty).
 */
export function loadDotEnv(): void {
  try {
    const envContent = readFileSync('.env', 'utf-8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
        // Do not overwrite keys already set in the environment (shell / CI / eval prefix).
        if (val && process.env[key] === undefined) process.env[key] = val
      }
    }
  } catch {
    /* no .env file */
  }
}
