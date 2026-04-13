import { join } from 'node:path'
import { existsSync } from 'node:fs'

/** Repo root from WIKI_DIR env var */
export const repoDir = () => process.env.WIKI_DIR ?? '/wiki'

/**
 * Wiki content directory: `<WIKI_DIR>/wiki` if it exists, otherwise `<WIKI_DIR>` itself.
 * Matches the layout of the cirne/brain repo where markdown lives under the `wiki/` subdir.
 */
export const wikiDir = () => {
  const repo = repoDir()
  const sub = join(repo, 'wiki')
  return existsSync(sub) ? sub : repo
}
