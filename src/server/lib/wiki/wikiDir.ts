import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { skillsDataDir, wikiContentDir } from '@server/lib/platform/brainHome.js'

/** Markdown wiki content: `$BRAIN_WIKI_ROOT/wiki` (bundled macOS) or `$BRAIN_HOME/wiki` (dev). */
export const wikiDir = () => wikiContentDir()

/** User skills (slash commands): `$BRAIN_HOME/skills`. */
export const skillsDir = () => skillsDataDir()

/**
 * Remove all wiki files and subdirs under `contentRoot` (dev reset). Leaves an empty root dir (creates nothing).
 */
export async function wipeWikiContentAt(contentRoot: string): Promise<void> {
  if (!existsSync(contentRoot)) return

  const entries = await readdir(contentRoot, { withFileTypes: true })
  for (const ent of entries) {
    if (ent.name === '.git') continue
    await rm(join(contentRoot, ent.name), { recursive: true, force: true })
  }
}

/**
 * Remove all wiki files and subdirs (dev hard-reset). Recreates an empty wiki content root.
 */
export async function wipeWikiContent(): Promise<void> {
  await wipeWikiContentAt(wikiDir())
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
