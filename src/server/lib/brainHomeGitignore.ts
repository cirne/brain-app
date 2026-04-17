import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brainHome } from './brainHome.js'

/** Resolve shared/brain-home-default.gitignore (src/, dist/server/, cwd). */
export function resolveBrainHomeDefaultGitignorePath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '../../../shared/brain-home-default.gitignore'),
    join(here, '../../shared/brain-home-default.gitignore'),
    join(process.cwd(), 'shared/brain-home-default.gitignore'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

/** Write `$BRAIN_HOME/.gitignore` from the repo template if missing; never overwrites. */
export async function ensureBrainHomeGitignore(): Promise<void> {
  const root = brainHome()
  try {
    await mkdir(root, { recursive: true })
  } catch (e) {
    console.warn('[brain-app] brain home: could not create directory:', e)
    return
  }

  const dest = join(root, '.gitignore')
  if (existsSync(dest)) return

  const templatePath = resolveBrainHomeDefaultGitignorePath()
  if (!templatePath) {
    console.warn(
      '[brain-app] brain home: shared/brain-home-default.gitignore not found; skipping .gitignore',
    )
    return
  }

  try {
    const body = await readFile(templatePath, 'utf-8')
    await writeFile(dest, body, 'utf-8')
  } catch (e) {
    console.warn('[brain-app] brain home: could not write .gitignore:', e)
  }
}
