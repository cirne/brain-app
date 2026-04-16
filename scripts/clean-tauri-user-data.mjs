#!/usr/bin/env node
/**
 * Remove data written by the **Tauri-packaged** Brain app (release spawn defaults in `desktop/src/brain_paths.rs`).
 * Does not touch CLI/dev-only locations (`~/.ripmail`, `./data`, or paths from `.env` — those differ).
 *
 * macOS:
 *   ~/Library/Application Support/Brain   (chat, onboarding, ripmail index)
 *   ~/Documents/Brain                     (wiki)
 *   ~/Library/Logs/com.cirne.brain        (node-server.log, etc.)
 *
 * Linux / non-macOS Tauri:
 *   ~/.brain                              (chat + ripmail under .brain/)
 *   ~/Documents/Brain                     (wiki)
 *
 * Does NOT delete `.env` or build artifacts.
 *
 * Usage: npm run tauri:clean-data [--dry-run]
 */

import { rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir, platform } from 'node:os'

const home = homedir()
const dryRun = process.argv.includes('--dry-run')

function collectPaths() {
  /** @type {string[]} */
  const paths = []

  if (platform() === 'darwin') {
    paths.push(join(home, 'Library/Application Support/Brain'))
    paths.push(join(home, 'Library/Logs/com.cirne.brain'))
    paths.push(join(home, 'Documents/Brain'))
  } else {
    paths.push(join(home, '.brain'))
    paths.push(join(home, 'Documents/Brain'))
  }

  return paths.map((p) => resolve(p)).sort()
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
  console.log('[tauri:clean-data] done (Tauri bundle paths only; did not remove .env)')
}
