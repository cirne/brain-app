import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Merge repo-root `.env` into `process.env` (only non-empty values), matching
 * `src/server/lib/platform/loadDotEnv.ts` so Playwright picks up `BRAIN_ENRON_DEMO_SECRET` without shell exports.
 */
export function loadRepoDotenv(repoRoot: string): void {
  try {
    const envPath = join(repoRoot, '.env')
    const envContent = readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
        if (val) process.env[key] = val
      }
    }
  } catch {
    /* missing or unreadable — ok for CI without .env */
  }
}
