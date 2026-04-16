import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/** Repo root from WIKI_DIR env var */
export const repoDir = () => process.env.WIKI_DIR ?? '/wiki'

/** User skills (slash commands): `<WIKI_DIR>/skills` — sibling of `wiki/`, not inside wiki content. */
export const skillsDir = () => join(repoDir(), 'skills')

/**
 * Wiki content directory: `<WIKI_DIR>/wiki` if it exists, otherwise `<WIKI_DIR>` itself.
 * Matches the layout of the cirne/brain repo where markdown lives under the `wiki/` subdir.
 */
export const wikiDir = () => {
  const repo = repoDir()
  const sub = join(repo, 'wiki')
  return existsSync(sub) ? sub : repo
}

/**
 * Remove all wiki files and subdirs (dev hard-reset). Recreates an empty wiki content root.
 * When `wiki/` exists under the repo, only that subtree is removed (git metadata at repo root stays).
 * When the repo root is the wiki root, removes all top-level entries except `.git`.
 */
export async function wipeWikiContent(): Promise<void> {
  const contentRoot = wikiDir()
  const repo = repoDir()
  if (!existsSync(contentRoot)) return

  if (contentRoot === repo) {
    const entries = await readdir(contentRoot, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.name === '.git') continue
      await rm(join(contentRoot, ent.name), { recursive: true, force: true })
    }
    return
  }

  await rm(contentRoot, { recursive: true, force: true })
  await mkdir(contentRoot, { recursive: true })
}
