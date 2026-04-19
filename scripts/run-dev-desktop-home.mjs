#!/usr/bin/env node
/**
 * Same as `run-dev.mjs`, but uses Brain.app's default data paths on macOS
 * (`~/Library/Application Support/Brain`, `~/Documents/Brain/wiki` parent)
 * instead of repo `./data`.
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

if (process.platform !== 'darwin') {
  console.error(
    'dev:desktop-home matches Brain.app paths on macOS only. Use npm run dev with BRAIN_HOME set manually.',
  )
  process.exit(1)
}

const home = homedir()
process.env.BRAIN_HOME = join(home, 'Library/Application Support/Brain')
process.env.BRAIN_WIKI_ROOT = join(home, 'Documents/Brain')

const child = spawn(process.execPath, [join(root, 'scripts/run-dev.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: false,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
