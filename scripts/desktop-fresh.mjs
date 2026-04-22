#!/usr/bin/env node
/**
 * 1. `desktop:clean-data`
 * 2. `npm run desktop:build`
 * 3. macOS: open newest `.dmg` (mode `dmg`) or `Braintunnel.app` under `target/**/release/bundle/macos/` (mode `app`)
 *
 * Usage:
 *   npm run desktop:fresh              # default — DMG for drag-to-Applications
 *   npm run desktop:fresh -- app       # open built .app
 *   node scripts/desktop-fresh.mjs dmg|app
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = (process.argv[2] || 'dmg').toLowerCase()
if (mode !== 'dmg' && mode !== 'app') {
  console.error('[desktop:fresh] usage: npm run desktop:fresh [-- dmg|app]')
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

function findBraintunnelApp() {
  const names = ['Braintunnel.app', 'Brain.app']
  const bases = [
    join(root, 'target', 'release', 'bundle', 'macos'),
    join(root, 'desktop', 'target', 'release', 'bundle', 'macos'),
  ]
  for (const b of bases) {
    for (const name of names) {
      const app = join(b, name)
      if (existsSync(app)) return app
    }
  }
  return null
}

execSync('npm run desktop:clean-data', { cwd: root, stdio: 'inherit' })
execSync('npm run desktop:build', { cwd: root, stdio: 'inherit' })

if (mode === 'dmg') {
  const dmg = findNewestDmg()
  if (!dmg) {
    console.error(
      '[desktop:fresh] no .dmg found under target/**/release/bundle (build a macOS bundle with dmg target, or open the .app via npm run desktop:fresh -- app)',
    )
    process.exit(1)
  }
  console.log(`[desktop:fresh] ${dmg}`)
  if (process.platform === 'darwin') {
    execFileSync('open', [dmg], { stdio: 'inherit' })
  } else {
    console.log('[desktop:fresh] not macOS — copy/open the DMG from the path above on a Mac')
  }
} else {
  const app = findBraintunnelApp()
  if (!app) {
    console.error(
      `[desktop:fresh] Braintunnel.app not found under target/**/release/bundle/macos (checked Braintunnel.app, legacy Brain.app)`,
    )
    process.exit(1)
  }
  console.log(`[desktop:fresh] ${app}`)
  if (process.platform === 'darwin') {
    execFileSync('open', [app], { stdio: 'inherit' })
  } else {
    console.log(`[desktop:fresh] built: ${app} (open manually on this OS)`)
  }
}
