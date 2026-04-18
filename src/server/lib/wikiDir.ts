import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { skillsDataDir, wikiContentDir } from './brainHome.js'

/** Markdown wiki content: `$BRAIN_HOME/wiki`. */
export const wikiDir = () => wikiContentDir()

/** User skills (slash commands): `$BRAIN_HOME/skills`. */
export const skillsDir = () => skillsDataDir()

/**
 * Remove all wiki files and subdirs (dev hard-reset). Recreates an empty wiki content root.
 */
export async function wipeWikiContent(): Promise<void> {
  const contentRoot = wikiDir()
  if (!existsSync(contentRoot)) return

  const entries = await readdir(contentRoot, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === '.git') continue
    await rm(join(contentRoot, ent.name), { recursive: true, force: true })
  }
}

/** Root profile file — preserved by {@link wipeWikiContentExceptMeMd}. */
const KEEP_ROOT_ME = 'me.md'

/**
 * Remove every file and directory under the wiki vault except root `me.md` (and `.git`).
 * Used to re-run wiki seeding without re-profiling.
 */
export async function wipeWikiContentExceptMeMd(): Promise<void> {
  const contentRoot = wikiDir()
  if (!existsSync(contentRoot)) return

  const entries = await readdir(contentRoot, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === '.git') continue
    if (ent.name === KEEP_ROOT_ME && ent.isFile()) continue
    await rm(join(contentRoot, ent.name), { recursive: true, force: true })
  }
}
