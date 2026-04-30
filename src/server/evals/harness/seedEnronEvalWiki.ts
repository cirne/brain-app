import { copyFileSync, mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ensureStarterWikiSeed } from '@server/lib/wiki/starterWikiSeed.js'
import { ensureWikiVaultScaffoldForBuildout } from '@server/lib/wiki/wikiVaultScaffold.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { getEvalRepoRoot } from './runLlmJsonlEval.js'

/** Pre-created stubs so wiki buildout evals use **edit** only (OPP-067 deepen-only). */
const EVAL_BUILDOUT_STUBS: Record<string, string> = {
  'topics/eval-wiki-smoke.md': '## Chat capture\n\n(eval stub)\n',
  'people/richard-shapiro.md': '## Chat capture\n\n(stub)\n',
  'people/jeff-dasovich.md': '## Chat capture\n\n(stub)\n',
  'topics/direct-access.md': '## Chat capture\n\n(stub)\n',
  'topics/wiki-bo-janet-weekly-snippet.md': '## Chat capture\n\n(stub)\n',
  'topics/wiki-bo-shapiro-notes.md': '## Chat capture\n\n(stub)\n',
  'topics/wiki-bo-dubuque-brief.md': '## Chat capture\n\n(stub)\n',
}

async function ensureEvalBuildoutStubs(wikiRoot: string): Promise<void> {
  for (const [rel, body] of Object.entries(EVAL_BUILDOUT_STUBS)) {
    const full = join(wikiRoot, rel)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, body, 'utf8')
  }
}

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
  await ensureEvalBuildoutStubs(root)
}
