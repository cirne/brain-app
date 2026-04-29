import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ensureStarterWikiSeed } from '@server/lib/wiki/starterWikiSeed.js'
import { ensureWikiVaultScaffoldForBuildout } from '@server/lib/wiki/wikiVaultScaffold.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { getEvalRepoRoot } from './runLlmJsonlEval.js'

/**
 * Seed an isolated eval wiki: starter layout + ripmail scaffold + Enron fixture me.md / assistant.md.
 * Requires `BRAIN_WIKI_ROOT` or default `BRAIN_HOME/wiki` to be set before call (via `wikiDir()`).
 */
export async function seedEnronEvalWiki(): Promise<void> {
  const root = wikiDir()
  mkdirSync(root, { recursive: true })
  await ensureStarterWikiSeed(root)
  await ensureWikiVaultScaffoldForBuildout(root)
  const repo = getEvalRepoRoot()
  const fixtureDir = join(repo, 'eval', 'fixtures', 'enron-kean-wiki')
  copyFileSync(join(fixtureDir, 'me.md'), join(root, 'me.md'))
  copyFileSync(join(fixtureDir, 'assistant.md'), join(root, 'assistant.md'))
}
