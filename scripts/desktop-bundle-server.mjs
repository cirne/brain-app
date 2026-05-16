#!/usr/bin/env node
/**
 * Populate `desktop/resources/server-bundle/` for Tauri release builds:
 * production `node_modules/`, `dist/`, and the current Node binary (matches active `nvm` / Corepack toolchain).
 *
 * Prerequisite: `pnpm run build` (this script checks that `dist/` exists).
 *
 * Usage: pnpm run desktop:bundle-server
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'desktop/resources/server-bundle')
const distSrc = join(root, 'dist')

if (!existsSync(distSrc)) {
  console.error('[desktop:bundle-server] missing dist/ — run `pnpm run build` first.')
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

copyFileSync(join(root, 'package.json'), join(dest, 'package.json'))
copyFileSync(join(root, 'pnpm-lock.yaml'), join(dest, 'pnpm-lock.yaml'))

execSync('pnpm install --frozen-lockfile --prod', {
  cwd: dest,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
})

cpSync(distSrc, join(dest, 'dist'), { recursive: true })

const nodeName = basename(process.execPath)
const nodeDest = join(dest, nodeName)
copyFileSync(process.execPath, nodeDest)
if (process.platform !== 'win32') {
  chmodSync(nodeDest, 0o755)
}

console.log('[desktop:bundle-server] done →', dest, `(bundled node: ${nodeName})`)
