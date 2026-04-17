#!/usr/bin/env node
/**
 * Remove data for the **Tauri-packaged** Brain app. Paths come from `shared/bundle-defaults.json`
 * (same defaults as `desktop/src/brain_paths.rs` and server `bundleDefaults.ts`).
 *
 * - If `BRAIN_HOME` is set: removes that directory (what the app uses) plus macOS Tauri logs
 *   when `tauri_logs_dir_darwin` is present in bundle-defaults.
 * - Otherwise: removes the default bundled `BRAIN_HOME` for this OS + macOS logs (when darwin).
 *
 * Does not remove dev `./data` unless you set `BRAIN_HOME` to that path. Does not touch
 * standalone CLI `~/.ripmail` unless it is your `BRAIN_HOME`.
 *
 * Usage: npm run tauri:clean-data [--dry-run]
 */

import { rmSync, existsSync, readFileSync } from 'node:fs'
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

function collectPaths() {
  const b = loadBundleDefaults()
  /** @type {string[]} */
  const paths = []

  if (process.env.BRAIN_HOME) {
    paths.push(resolve(process.env.BRAIN_HOME))
  } else {
    const rel = platform() === 'darwin' ? b.default_brain_home.darwin : b.default_brain_home.other
    paths.push(resolve(join(homedir(), rel)))
  }

  if (platform() === 'darwin' && b.tauri_logs_dir_darwin) {
    paths.push(resolve(join(homedir(), b.tauri_logs_dir_darwin)))
  }

  return [...new Set(paths)].sort()
}

for (const p of collectPaths()) {
  if (!existsSync(p)) continue
  if (dryRun) {
    console.log(`[dry-run] would remove ${p}`)
    continue
  }
  rmSync(p, { recursive: true, force: true })
  console.log(`removed ${p}`)
}

if (dryRun) {
  console.log('[tauri:clean-data] dry run only; omit --dry-run to delete')
} else {
  console.log('[tauri:clean-data] done')
}
