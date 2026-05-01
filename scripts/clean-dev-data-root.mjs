#!/usr/bin/env node
/**
 * Full local dev reset: deletes the entire multi-tenant data root (all tenants + `.global/`).
 *
 * Matches `npm run dev` default storage: `./data` unless `BRAIN_DATA_ROOT` is set.
 *
 * Usage: npm run dev:clean
 * Optional: BRAIN_DATA_ROOT=/custom/path npm run dev:clean
 */
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const envRoot = process.env.BRAIN_DATA_ROOT?.trim()
const dataRoot = envRoot ? resolve(repoRoot, envRoot) : resolve(repoRoot, 'data')

async function main() {
  if (!existsSync(dataRoot)) {
    console.log(`[dev:clean] nothing to remove (no ${dataRoot}).`)
    return
  }
  console.log(`[dev:clean] removing ${dataRoot}`)
  await rm(dataRoot, { recursive: true, force: true })
  console.log('[dev:clean] done.')
}

main().catch((e) => {
  console.error('[dev:clean]', e)
  process.exit(1)
})
