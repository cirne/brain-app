#!/usr/bin/env node
/**
 * Clean packaged-app user data, build Brain.app (+ DMG), then launch the built .app (macOS).
 * Usage: npm run tauri:run-release:fresh
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'target/release/bundle/macos/Brain.app')

execSync('npm run tauri:clean-data', { cwd: root, stdio: 'inherit' })
execSync('npm run tauri build', { cwd: root, stdio: 'inherit' })

if (!existsSync(app)) {
  console.error(`[tauri:run-release:fresh] Brain.app not found at ${app}`)
  process.exit(1)
}

if (process.platform === 'darwin') {
  execSync(`open "${app}"`, { stdio: 'inherit', shell: true })
} else {
  console.log(`[tauri:run-release:fresh] built: ${app} (open manually on this OS)`)
}
