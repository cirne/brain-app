#!/usr/bin/env node
/**
 * Creates src-tauri/binaries/ripmail-<host-triple> -> ripmail on PATH (or RIPMAIL_SOURCE).
 * Required for Tauri `externalBin` / sidecar resolution at dev and build time.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const binariesDir = join(root, 'src-tauri', 'binaries')

function main() {
  let triple
  try {
    triple = execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim()
  } catch {
    console.warn('[link-ripmail-sidecar] rustc not found; skip ripmail sidecar link')
    process.exit(0)
  }

  const fromEnv = process.env.RIPMAIL_SOURCE?.trim()
  let ripmailPath
  if (fromEnv) {
    ripmailPath = fromEnv
  } else {
    try {
      ripmailPath = execSync('command -v ripmail', {
        encoding: 'utf8',
        shell: '/bin/bash',
      }).trim()
    } catch {
      console.warn(
        '[link-ripmail-sidecar] ripmail not on PATH; skip (install ripmail or set RIPMAIL_SOURCE)',
      )
      process.exit(0)
    }
  }

  if (!existsSync(ripmailPath)) {
    console.warn(`[link-ripmail-sidecar] ${ripmailPath} does not exist; skip`)
    process.exit(0)
  }

  mkdirSync(binariesDir, { recursive: true })
  const dest = join(binariesDir, `ripmail-${triple}`)
  try {
    if (existsSync(dest)) unlinkSync(dest)
  } catch {
    // ignore
  }
  symlinkSync(ripmailPath, dest)
  console.log(`[link-ripmail-sidecar] ${dest} -> ${ripmailPath}`)
}

main()
