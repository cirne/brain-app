#!/usr/bin/env node
/**
 * Remove **dev** Brain durable data: default `./data` (same as `brainHome()` when
 * `BRAIN_HOME` is unset and not bundled), or `$BRAIN_HOME` when set.
 * Does not touch packaged-app bundle paths (`desktop:clean-data`) or standalone `~/.ripmail`.
 *
 * Usage: npm run dev:clean [--dry-run]
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

function targetPaths() {
  const paths = []
  if (process.env.BRAIN_HOME) {
    paths.push(resolve(process.env.BRAIN_HOME))
  } else {
    paths.push(join(process.cwd(), 'data'))
  }

  if (process.env.BRAIN_DATA_ROOT) {
    paths.push(resolve(process.env.BRAIN_DATA_ROOT))
  } else {
    paths.push(join(process.cwd(), 'data-multitenant'))
  }

  return paths
}

const targets = targetPaths()
const bundledDefault = defaultBundledBrainHomeResolved()

function sameResolvedPath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}

for (const target of targets) {
  if (target === bundledDefault || sameResolvedPath(target, bundledDefault)) {
    console.error(
      `[dev:clean] target points at the bundled default app directory: ${target}. Use npm run desktop:clean-data instead (or unset BRAIN_HOME/BRAIN_DATA_ROOT to wipe ./data).`,
    )
    process.exit(1)
  }
}

let removedAny = false
for (const target of targets) {
  if (!existsSync(target)) {
    console.log(`[dev:clean] nothing to remove (${target})`)
    continue
  }

  if (dryRun) {
    console.log(`[dry-run] would remove ${target}`)
    removedAny = true
    continue
  }

  rmSync(target, { recursive: true, force: true })
  console.log(`[dev:clean] removed ${target}`)
  removedAny = true
}

if (dryRun && removedAny) {
  console.log('[dev:clean] dry run only; omit --dry-run to delete')
}
