#!/usr/bin/env node
/**
 * Reset **eval** Brain app data under `./data-eval/brain`: wiki vault, chat history,
 * and `var/` / `cache/` (edit log, nav recents, sessions, dir icon cache, calendar JSON, etc.).
 * Does **not** remove `ripmail/` (indexed mail, maildir, config) or `skills/`.
 *
 * Usage: npm run dev:eval:clean [--dry-run]
 *
 * Always targets `data-eval/brain` relative to the repo root — ignores `BRAIN_HOME`.
 */
import { readFileSync, existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const evalBrain = resolve(repoRoot, 'data-eval/brain')

/** Dirs to remove and recreate: all layout directories except `ripmail` and `skills`. */
function resetDirsFromLayout() {
  const path = join(repoRoot, 'shared/brain-layout.json')
  const L = JSON.parse(readFileSync(path, 'utf8'))
  const dirs = L.directories
  const all = [dirs.wiki, dirs.chats, dirs.cache, dirs.var]
  return all
}

const dryRun = process.argv.includes('--dry-run')

async function main() {
  if (!existsSync(evalBrain)) {
    console.error(`[dev:eval:clean] nothing at ${evalBrain} — run eval:build first.`)
    process.exit(1)
  }

  const rip = join(evalBrain, 'ripmail')
  if (!existsSync(rip)) {
    console.warn(`[dev:eval:clean] note: ${rip} missing — ripmail index was already absent.`)
  }

  const toReset = resetDirsFromLayout()

  if (dryRun) {
    console.log(`[dry-run] would reset under ${evalBrain}:`)
    for (const d of toReset) {
      console.log(`  - remove and recreate empty: ${d}/`)
    }
    console.log('  - leave intact: ripmail/, skills/')
    console.log('[dev:eval:clean] dry run only; omit --dry-run to apply')
    process.exit(0)
  }

  for (const name of toReset) {
    const p = join(evalBrain, name)
    if (existsSync(p)) {
      await rm(p, { recursive: true, force: true })
    }
    await mkdir(p, { recursive: true })
    console.log(`[dev:eval:clean] reset ${name}/`)
  }

  console.log(`[dev:eval:clean] done (ripmail/ and skills/ unchanged)`)
}

main().catch((e) => {
  console.error('[dev:eval:clean]', e)
  process.exit(1)
})
