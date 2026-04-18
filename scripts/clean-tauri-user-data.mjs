#!/usr/bin/env node
/**
 * Remove data for the **Tauri-packaged** Brain app. Paths come from `shared/bundle-defaults.json`
 * (same defaults as `desktop/src/brain_paths.rs` and server `bundleDefaults.ts`).
 *
 * - **Local root** (`BRAIN_HOME`): Application Support on macOS (or `BRAIN_HOME` when set).
 * - **Wiki parent** (`BRAIN_WIKI_ROOT`, OPP-024): `~/Documents/Brain` on macOS — removed when you
 *   use default paths (unset `BRAIN_HOME`, or `BRAIN_HOME` equals the bundle default), or when
 *   `BRAIN_WIKI_ROOT` is set explicitly.
 * - **macOS Tauri logs** when `tauri_logs_dir_darwin` is present.
 * - **macOS WKWebView** (`webkit_data_dir_darwin`): localStorage / sessionStorage / IndexedDB for the
 *   bundled app live here — **not** under `BRAIN_HOME`. Must be removed for a true UI reset.
 *
 * Does not remove dev `./data` unless `BRAIN_HOME` points there. Does not touch standalone
 * `~/.ripmail` unless it is your `BRAIN_HOME`.
 *
 * Usage: npm run desktop:clean-data [--dry-run]
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
  const plat = platform()
  const rel = plat === 'darwin' ? b.default_brain_home.darwin : b.default_brain_home.other
  const defaultBrain = resolve(join(homedir(), rel))
  const homePath = process.env.BRAIN_HOME ? resolve(process.env.BRAIN_HOME) : defaultBrain

  /** @type {string[]} */
  const paths = [homePath]

  if (plat === 'darwin') {
    if (process.env.BRAIN_WIKI_ROOT) {
      paths.push(resolve(process.env.BRAIN_WIKI_ROOT))
    } else if (!process.env.BRAIN_HOME || homePath === defaultBrain) {
      const wikiRel = b.default_wiki_parent_darwin ?? 'Documents/Brain'
      paths.push(resolve(join(homedir(), wikiRel)))
    }
  }

  if (plat === 'darwin' && b.tauri_logs_dir_darwin) {
    paths.push(resolve(join(homedir(), b.tauri_logs_dir_darwin)))
  }

  if (plat === 'darwin' && b.webkit_data_dir_darwin) {
    paths.push(resolve(join(homedir(), b.webkit_data_dir_darwin)))
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
  console.log('[desktop:clean-data] dry run only; omit --dry-run to delete')
} else {
  console.log('[desktop:clean-data] done')
}
