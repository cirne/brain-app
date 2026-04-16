import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Shipped default skills (source: repo `assets/user-skills/`; production: `dist/server/assets/user-skills/`).
 * Returns null if neither layout is present (warn in seeder).
 * Tests may set `BRAIN_USER_SKILLS_BUNDLE` to an absolute path.
 */
export function bundledUserSkillsDir(): string | null {
  const env = process.env.BRAIN_USER_SKILLS_BUNDLE
  if (env && existsSync(env)) return env
  const fromDistBundle = join(here, '../assets/user-skills')
  if (existsSync(fromDistBundle)) return fromDistBundle
  const fromRepo = join(here, '../../../assets/user-skills')
  if (existsSync(fromRepo)) return fromRepo
  return null
}
