#!/usr/bin/env node
/**
 * Copy production server artifacts into desktop/resources/server-bundle for packaged Braintunnel.app.
 * Run after `npm run build`.
 *
 * Includes: dist/, node_modules (prod), node binary, and ripmail binary (release build).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const out = join(root, 'desktop/resources/server-bundle')
const dist = join(root, 'dist')

if (!existsSync(join(dist, 'server/index.js'))) {
  console.error('[bundle-tauri-server] dist/server/index.js missing — run npm run build first')
  process.exit(1)
}

if (existsSync(out)) {
  rmSync(out, { recursive: true })
}
mkdirSync(join(root, 'desktop/resources'), { recursive: true })
mkdirSync(out, { recursive: true })

cpSync(dist, join(out, 'dist'), { recursive: true })
const sharedSrc = join(root, 'shared')
if (existsSync(sharedSrc)) {
  cpSync(sharedSrc, join(out, 'shared'), { recursive: true })
}
cpSync(join(root, 'package.json'), join(out, 'package.json'))
cpSync(join(root, 'package-lock.json'), join(out, 'package-lock.json'))

console.log('[bundle-tauri-server] npm ci --omit=dev …')
execSync('npm ci --omit=dev', { cwd: out, stdio: 'inherit' })

const nodePath = process.execPath
const nodeDest = join(out, 'node')
cpSync(nodePath, nodeDest)
chmodSync(nodeDest, 0o755)
console.log(`[bundle-tauri-server] copied node → ${nodeDest}`)

// --- ripmail (release build) ---
console.log('[bundle-tauri-server] cargo build -p ripmail --release …')
execSync('cargo build -p ripmail --release', { cwd: root, stdio: 'inherit' })

const targetDir = JSON.parse(
  execSync('cargo metadata --format-version 1 --no-deps', { cwd: root, encoding: 'utf8' })
).target_directory
const ripmailSrc = join(targetDir, 'release/ripmail')
if (!existsSync(ripmailSrc)) {
  console.error(`[bundle-tauri-server] ripmail release binary not found at ${ripmailSrc}`)
  process.exit(1)
}
const ripmailDest = join(out, 'ripmail')
cpSync(ripmailSrc, ripmailDest)
chmodSync(ripmailDest, 0o755)
console.log(`[bundle-tauri-server] copied ripmail → ${ripmailDest}`)

console.log(`[bundle-tauri-server] done → ${out}`)
