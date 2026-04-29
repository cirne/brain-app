import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Shipped starter wiki vault files (source: repo `assets/starter-wiki/`; production:
 * `dist/server/assets/starter-wiki/`). Returns null if missing (seed is a no-op).
 * Tests may set `BRAIN_STARTER_WIKI_BUNDLE` to an absolute path.
 */
export function bundledStarterWikiDir(): string | null {
  const env = process.env.BRAIN_STARTER_WIKI_BUNDLE
  if (env && existsSync(env)) return env
  const candidates = [
    join(here, 'assets/starter-wiki'),
    join(here, '../assets/starter-wiki'),
    join(here, '../../assets/starter-wiki'),
    join(here, '../../../assets/starter-wiki'),
    join(here, '../../../../assets/starter-wiki'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}
