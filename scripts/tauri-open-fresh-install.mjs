#!/usr/bin/env node
/**
 * 1. Clear Tauri app data (same paths as `tauri:clean-data`).
 * 2. `npm run tauri:build` (DMG on macOS when bundle targets include dmg).
 * 3. On macOS, `open` the newest `.dmg` under `target/.../release/bundle/` (recursive).
 *
 * Usage: npm run tauri:open-fresh-install
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

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

execSync('npm run tauri:clean-data', { cwd: root, stdio: 'inherit' })
execSync('npm run tauri:build', { cwd: root, stdio: 'inherit' })

const dmg = findNewestDmg()
if (!dmg) {
  console.error(
    '[tauri:open-fresh-install] no .dmg found under target/**/release/bundle (build a macOS bundle with dmg target, or open the .app under bundle/macos/)',
  )
  process.exit(1)
}

console.log(`[tauri:open-fresh-install] ${dmg}`)

if (process.platform === 'darwin') {
  execFileSync('open', [dmg], { stdio: 'inherit' })
} else {
  console.log('[tauri:open-fresh-install] not macOS — copy/open the DMG from the path above on a Mac')
}
