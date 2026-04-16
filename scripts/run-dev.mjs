#!/usr/bin/env node
/**
 * Starts `tsx watch` for the Hono server. If `RIPMAIL_BIN` is unset and
 * `target/debug/ripmail` exists (workspace build), use it so inbox routes work without a global install.
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function defaultWorkspaceRipmailBin() {
  try {
    const meta = JSON.parse(
      execSync('cargo metadata --format-version 1 --no-deps', {
        cwd: root,
        encoding: 'utf8',
      }),
    )
    const p = join(meta.target_directory, 'debug', 'ripmail')
    return existsSync(p) ? p : null
  } catch {
    const fallback = resolve(root, 'target/debug/ripmail')
    return existsSync(fallback) ? fallback : null
  }
}

if (!process.env.RIPMAIL_BIN) {
  const p = defaultWorkspaceRipmailBin()
  if (p) process.env.RIPMAIL_BIN = p
}

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
  // Re-run dev server when shipped user skills change (seeder reads these on boot).
  '--include',
  'assets/user-skills/**/*',
  'src/server/index.ts',
]

const tsxCli = join(root, 'node_modules/tsx/dist/cli.mjs')
const child = spawn(process.execPath, [tsxCli, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: false,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
