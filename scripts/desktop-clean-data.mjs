#!/usr/bin/env node
/**
 * Deletes packaged-app directories: default macOS `BRAIN_HOME` / `BRAIN_WIKI_ROOT`, or explicit env paths.
 * Destructive — requires `--yes`.
 *
 * Usage: pnpm run desktop:clean-data -- --yes
 */
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const yes = process.argv.includes('--yes')
if (!yes) {
  console.error(
    '[desktop:clean-data] Refusing to run without --yes. Example: pnpm run desktop:clean-data -- --yes',
  )
  process.exit(1)
}

async function main() {
  const home = homedir()
  /** @type {string[]} */
  const targets = []

  const bhEnv = process.env.BRAIN_HOME?.trim()
  if (bhEnv) targets.push(resolve(bhEnv))
  else if (process.platform === 'darwin') {
    targets.push(join(home, 'Library', 'Application Support', 'Brain'))
  }

  const wikiEnv = process.env.BRAIN_WIKI_ROOT?.trim()
  if (wikiEnv) targets.push(resolve(wikiEnv))
  else if (process.platform === 'darwin') {
    targets.push(join(home, 'Documents', 'Brain'))
  }

  const unique = [...new Set(targets)]
  if (unique.length === 0) {
    console.log('[desktop:clean-data] no targets (set BRAIN_HOME / BRAIN_WIKI_ROOT or run on macOS).')
    return
  }

  for (const p of unique) {
    if (!existsSync(p)) {
      console.log(`[desktop:clean-data] skip (missing): ${p}`)
      continue
    }
    console.log(`[desktop:clean-data] removing ${p}`)
    await rm(p, { recursive: true, force: true })
  }
  console.log('[desktop:clean-data] done.')
}

main().catch((e) => {
  console.error('[desktop:clean-data]', e)
  process.exit(1)
})
