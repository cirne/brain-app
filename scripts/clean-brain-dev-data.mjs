#!/usr/bin/env node
/**
 * Remove **dev** Brain durable data: default `./data` (same as `brainHome()` when
 * `BRAIN_HOME` is unset and not bundled), or `$BRAIN_HOME` when set.
 * Does not touch packaged-app bundle paths (`desktop:clean-data`) or standalone `~/.ripmail`.
 *
 * Usage: npm run brain:clean:dev [--dry-run]
 */

import { rmSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir, platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')

function loadBundleDefaults() {
  const p = join(root, 'shared/bundle-defaults.json')
  return JSON.parse(readFileSync(p, 'utf-8'))
}

function defaultBundledBrainHomeResolved() {
  const b = loadBundleDefaults()
  const rel = platform() === 'darwin' ? b.default_brain_home.darwin : b.default_brain_home.other
  return resolve(join(homedir(), rel))
}

function targetPath() {
  if (process.env.BRAIN_HOME) return resolve(process.env.BRAIN_HOME)
  return join(process.cwd(), 'data')
}

const target = targetPath()
const bundledDefault = defaultBundledBrainHomeResolved()

function sameResolvedPath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}

if (target === bundledDefault || sameResolvedPath(target, bundledDefault)) {
  console.error(
    '[brain:clean:dev] BRAIN_HOME points at the bundled default app directory. Use npm run desktop:clean-data instead (or unset BRAIN_HOME to wipe ./data).',
  )
  process.exit(1)
}

if (!existsSync(target)) {
  console.log(`[brain:clean:dev] nothing to remove (${target})`)
  process.exit(0)
}

if (dryRun) {
  console.log(`[dry-run] would remove ${target}`)
  console.log('[brain:clean:dev] dry run only; omit --dry-run to delete')
  process.exit(0)
}

rmSync(target, { recursive: true, force: true })
console.log(`[brain:clean:dev] removed ${target}`)
