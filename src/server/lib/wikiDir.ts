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
