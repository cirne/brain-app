#!/usr/bin/env node
/**
 * Full local dev reset: deletes the entire multi-tenant data root (all tenants + `.global/`).
 *
 * Matches `npm run dev` default storage: `./data` unless `BRAIN_DATA_ROOT` is set.
 *
 * Usage: npm run dev:clean
 * Optional: BRAIN_DATA_ROOT=/custom/path npm run dev:clean
 */
import { existsSync, lstatSync } from 'node:fs'
import { rm, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const envRoot = process.env.BRAIN_DATA_ROOT?.trim()
const dataPath = envRoot ? resolve(repoRoot, envRoot) : join(repoRoot, 'data')

async function main() {
  if (!existsSync(dataPath)) {
    console.log(`[dev:clean] nothing to remove (no ${dataPath}).`)
    return
  }

  const stat = lstatSync(dataPath)
  if (stat.isSymbolicLink()) {
    console.log(
      `[dev:clean] ./data is a symlink (shared worktree data) — removing link only: ${dataPath}`,
    )
    await unlink(dataPath)
    console.log('[dev:clean] done (primary data tree unchanged).')
    return
  }

  console.log(`[dev:clean] removing ${dataPath}`)
  await rm(dataPath, { recursive: true, force: true })
  console.log('[dev:clean] done.')
}

main().catch((e) => {
  console.error('[dev:clean]', e)
  process.exit(1)
})
