import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Shipped default skills (source: repo `assets/user-skills/`; production: `dist/server/assets/user-skills/`).
 * Returns null if neither layout is present (warn in seeder).
 */
export function bundledUserSkillsDir(): string | null {
  const fromDistBundle = join(here, '../assets/user-skills')
  if (existsSync(fromDistBundle)) return fromDistBundle
  const fromRepo = join(here, '../../../assets/user-skills')
  if (existsSync(fromRepo)) return fromRepo
  return null
}
