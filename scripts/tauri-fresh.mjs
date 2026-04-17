#!/usr/bin/env node
/**
 * 1. `tauri:clean-data`
 * 2. `npm run tauri:build`
 * 3. macOS: open newest `.dmg` (mode `dmg`) or `Brain.app` under `target/**/release/bundle/macos/` (mode `app`)
 *
 * Usage:
 *   node scripts/tauri-fresh.mjs dmg   # default — DMG for drag-to-Applications
 *   node scripts/tauri-fresh.mjs app   # open built .app
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = (process.argv[2] || 'dmg').toLowerCase()
if (mode !== 'dmg' && mode !== 'app') {
  console.error('[tauri:fresh] usage: node scripts/tauri-fresh.mjs dmg|app')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string} dir */
function collectDmgs(dir) {
  /** @type {string[]} */
  const out = []
  if (!existsSync(dir)) return out
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    if (!d) break
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name)
      if (ent.isDirectory()) stack.push(p)
      else if (ent.name.endsWith('.dmg')) out.push(p)
    }
  }
  return out
}

function findNewestDmg() {
  const bases = [
    join(root, 'target', 'release', 'bundle'),
    join(root, 'desktop', 'target', 'release', 'bundle'),
  ]
  /** @type {{ path: string; mtime: number } | null} */
  let best = null
  for (const base of bases) {
    for (const p of collectDmgs(base)) {
      const mtime = statSync(p).mtimeMs
      if (!best || mtime > best.mtime) best = { path: p, mtime }
    }
  }
  return best?.path ?? null
}

function findBrainApp() {
  const bases = [
    join(root, 'target', 'release', 'bundle', 'macos'),
    join(root, 'desktop', 'target', 'release', 'bundle', 'macos'),
  ]
  for (const b of bases) {
    const app = join(b, 'Brain.app')
    if (existsSync(app)) return app
  }
  return null
}

execSync('npm run tauri:clean-data', { cwd: root, stdio: 'inherit' })
execSync('npm run tauri:build', { cwd: root, stdio: 'inherit' })

if (mode === 'dmg') {
  const dmg = findNewestDmg()
  if (!dmg) {
    console.error(
      '[tauri:open-fresh-install] no .dmg found under target/**/release/bundle (build a macOS bundle with dmg target, or open the .app via npm run tauri:run-release:fresh)',
    )
    process.exit(1)
  }
  console.log(`[tauri:open-fresh-install] ${dmg}`)
  if (process.platform === 'darwin') {
    execFileSync('open', [dmg], { stdio: 'inherit' })
  } else {
    console.log('[tauri:open-fresh-install] not macOS — copy/open the DMG from the path above on a Mac')
  }
} else {
  const app = findBrainApp()
  if (!app) {
    console.error(
      `[tauri:run-release:fresh] Brain.app not found under target/**/release/bundle/macos (checked workspace targets)`,
    )
    process.exit(1)
  }
  console.log(`[tauri:run-release:fresh] ${app}`)
  if (process.platform === 'darwin') {
    execFileSync('open', [app], { stdio: 'inherit' })
  } else {
    console.log(`[tauri:run-release:fresh] built: ${app} (open manually on this OS)`)
  }
}
