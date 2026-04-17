#!/usr/bin/env node
/**
 * Installs the freshly-built Brain.app into /Applications on the local machine.
 * Kills any running Brain instance first, mounts the DMG, copies the app, then unmounts.
 *
 * Runs automatically after `npm run desktop:build` (via `desktop:install` in package.json).
 * Can also be invoked directly: `npm run desktop:install`
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP_NAME = 'Brain'
const MOUNT_POINT = `/Volumes/${APP_NAME}-install`

if (process.platform !== 'darwin') {
  console.log('[install-local] macOS only — skipping.')
  process.exit(0)
}

/** @param {string} dir @returns {string[]} */
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

const dmg = findNewestDmg()
if (!dmg) {
  console.error('[install-local] No DMG found under target/**/release/bundle — build first.')
  process.exit(1)
}
console.log(`[install-local] Using ${dmg}`)

// Kill running instance
const running = spawnSync('pgrep', ['-x', APP_NAME])
if (running.status === 0) {
  console.log(`[install-local] Stopping ${APP_NAME} ...`)
  spawnSync('pkill', ['-x', APP_NAME])
  execSync('sleep 1')
}

// Detach any leftover mount
if (existsSync(MOUNT_POINT)) {
  console.log(`[install-local] Detaching leftover ${MOUNT_POINT} ...`)
  spawnSync('hdiutil', ['detach', MOUNT_POINT, '-quiet', '-force'])
}

// Mount
console.log('[install-local] Mounting DMG ...')
execFileSync('hdiutil', ['attach', dmg, '-mountpoint', MOUNT_POINT, '-nobrowse', '-quiet'], {
  stdio: 'inherit',
})

try {
  // Copy — requires sudo on most systems
  console.log(`[install-local] Installing ${APP_NAME}.app → /Applications ...`)
  execFileSync('sudo', ['cp', '-Rf', `${MOUNT_POINT}/${APP_NAME}.app`, '/Applications/'], {
    stdio: 'inherit',
  })
} finally {
  execFileSync('hdiutil', ['detach', MOUNT_POINT, '-quiet'], { stdio: 'inherit' })
}

console.log(`[install-local] Done — /Applications/${APP_NAME}.app updated.`)
