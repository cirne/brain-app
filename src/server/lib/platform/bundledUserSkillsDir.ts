import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Shipped default skills (source: repo `assets/user-skills/`; production: `dist/server/assets/user-skills/`).
 * Returns null if neither layout is present; slash menu then lists only user `$BRAIN_HOME/skills/`.
 * Tests may set `BRAIN_USER_SKILLS_BUNDLE` to an absolute path.
 */
export function bundledUserSkillsDir(): string | null {
  const env = process.env.BRAIN_USER_SKILLS_BUNDLE
  if (env && existsSync(env)) return env
  const candidates = [
    join(here, 'assets/user-skills'),
    join(here, '../assets/user-skills'),
    join(here, '../../../assets/user-skills'),
    join(here, '../../../../assets/user-skills'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}
