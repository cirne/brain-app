import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brainHome, brainWikiParentRoot } from './brainHome.js'
import { tryResolveRepoSharedPath } from './resolveRepoSharedPath.js'

/** Resolve `shared/brain-home-default.gitignore` (optional; see {@link tryResolveRepoSharedPath}). */
export function resolveBrainHomeDefaultGitignorePath(): string | null {
  return tryResolveRepoSharedPath('brain-home-default.gitignore')
}

const WIKI_PARENT_GITIGNORE = `# Brain wiki tree (sync-friendly)
.DS_Store
`

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
  if (!existsSync(dest)) {
    const templatePath = resolveBrainHomeDefaultGitignorePath()
    if (!templatePath) {
      console.warn(
        '[brain-app] brain home: shared/brain-home-default.gitignore not found; skipping .gitignore',
      )
    } else {
      try {
        const body = await readFile(templatePath, 'utf-8')
        await writeFile(dest, body, 'utf-8')
      } catch (e) {
        console.warn('[brain-app] brain home: could not write .gitignore:', e)
      }
    }
  }

  const wikiParent = brainWikiParentRoot()
  if (wikiParent === root) return

  try {
    await mkdir(wikiParent, { recursive: true })
  } catch (e) {
    console.warn('[brain-app] wiki parent: could not create directory:', e)
    return
  }

  const wikiParentIgnore = join(wikiParent, '.gitignore')
  if (existsSync(wikiParentIgnore)) return

  try {
    await writeFile(wikiParentIgnore, WIKI_PARENT_GITIGNORE, 'utf-8')
  } catch (e) {
    console.warn('[brain-app] wiki parent: could not write .gitignore:', e)
  }
}
