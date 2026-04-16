#!/usr/bin/env node
/**
 * Copy production server artifacts into src-tauri/resources/server-bundle for packaged Brain.app.
 * Run after `npm run build`.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const out = join(root, 'src-tauri/resources/server-bundle')
const dist = join(root, 'dist')

if (!existsSync(join(dist, 'server/index.js'))) {
  console.error('[bundle-tauri-server] dist/server/index.js missing — run npm run build first')
  process.exit(1)
}

if (existsSync(out)) {
  rmSync(out, { recursive: true })
}
mkdirSync(join(root, 'src-tauri/resources'), { recursive: true })
mkdirSync(out, { recursive: true })

cpSync(dist, join(out, 'dist'), { recursive: true })
cpSync(join(root, 'package.json'), join(out, 'package.json'))
cpSync(join(root, 'package-lock.json'), join(out, 'package-lock.json'))

console.log('[bundle-tauri-server] npm ci --omit=dev …')
execSync('npm ci --omit=dev', { cwd: out, stdio: 'inherit' })

const nodePath = process.execPath
const nodeDest = join(out, 'node')
cpSync(nodePath, nodeDest)
chmodSync(nodeDest, 0o755)
console.log(`[bundle-tauri-server] copied node → ${nodeDest}`)
console.log(`[bundle-tauri-server] done → ${out}`)
