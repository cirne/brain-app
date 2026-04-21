#!/usr/bin/env node
/**
 * Shared dev server spawn: ripmail binary resolution + tsx watch on the Hono entry.
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(__dirname, '..')

function defaultWorkspaceRipmailBin() {
  try {
    const meta = JSON.parse(
      execSync('cargo metadata --format-version 1 --no-deps', {
        cwd: repoRoot,
        encoding: 'utf8',
      }),
    )
    const td = meta.target_directory
    const debug = join(td, 'debug', 'ripmail')
    const release = join(td, 'release', 'ripmail')
    if (existsSync(debug)) return debug
    if (existsSync(release)) return release
    return null
  } catch {
    const debug = resolve(repoRoot, 'target/debug/ripmail')
    const release = resolve(repoRoot, 'target/release/ripmail')
    if (existsSync(debug)) return debug
    if (existsSync(release)) return release
    return null
  }
}

/**
 * @param {Record<string, string | undefined>} [extraEnv] Merged into `process.env` before spawn (e.g. `BRAIN_DATA_ROOT`).
 */
export function spawnDevServer(extraEnv = {}) {
  if (!process.env.RIPMAIL_BIN) {
    const p = defaultWorkspaceRipmailBin()
    if (p) process.env.RIPMAIL_BIN = p
  }
  Object.assign(process.env, extraEnv)

  const args = [
    'watch',
    '--exclude',
    '.env',
    '--exclude',
    '.env.local',
    '--exclude',
    '.env.development',
    '--exclude',
    '.env.production',
    '--exclude',
    '.env.test',
    '--include',
    'assets/user-skills/**/*',
    'src/server/index.ts',
  ]

  const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs')
  const child = spawn(process.execPath, [tsxCli, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}
