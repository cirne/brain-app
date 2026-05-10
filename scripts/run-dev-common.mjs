#!/usr/bin/env node
/**
 * Shared dev server spawn: tsx watch on the Hono entry.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(__dirname, '..')

/**
 * @param {Record<string, string | undefined>} [extraEnv] Merged into `process.env` before spawn (e.g. `BRAIN_DATA_ROOT`).
 */
export function spawnDevServer(extraEnv = {}) {
  Object.assign(process.env, extraEnv)

  const args = [
    'watch',
    '--tsconfig',
    'tsconfig.server.json',
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
    '--include',
    'assets/starter-wiki/**/*',
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
