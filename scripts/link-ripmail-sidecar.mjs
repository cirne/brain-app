#!/usr/bin/env node
/**
 * Builds ripmail from the Cargo workspace and copies it to desktop/binaries/ripmail-<host-triple>
 * (Tauri `externalBin` / sidecar). Copy avoids broken symlinks when `CARGO_TARGET_DIR` is ephemeral.
 *
 * Release mode when RIPMAIL_RELEASE=1 or third arg `--release` (used by tauri build).
 */
import { execSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const binariesDir = join(root, 'desktop', 'binaries')

function main() {
  const release =
    process.env.RIPMAIL_RELEASE === '1' ||
    process.argv.includes('--release')

  let triple
  try {
    triple = execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim()
  } catch {
    console.warn('[link-ripmail-sidecar] rustc not found; skip ripmail sidecar link')
    process.exit(0)
  }

  const profile = release ? 'release' : 'debug'
  try {
    execSync(`cargo build -p ripmail ${release ? '--release' : ''}`, {
      cwd: root,
      stdio: 'inherit',
    })
  } catch {
    console.error('[link-ripmail-sidecar] cargo build -p ripmail failed')
    process.exit(1)
  }

  let targetRoot
  try {
    const meta = JSON.parse(
      execSync('cargo metadata --format-version 1 --no-deps', {
        cwd: root,
        encoding: 'utf8',
      }),
    )
    targetRoot = meta.target_directory
  } catch {
    targetRoot = join(root, 'target')
  }
  const built = resolve(targetRoot, profile, 'ripmail')
  if (!existsSync(built)) {
    console.error(`[link-ripmail-sidecar] expected binary missing: ${built}`)
    process.exit(1)
  }

  const fromEnv = process.env.RIPMAIL_SOURCE?.trim()
  const ripmailPath = fromEnv || built

  if (!existsSync(ripmailPath)) {
    console.error(`[link-ripmail-sidecar] ${ripmailPath} does not exist`)
    process.exit(1)
  }

  mkdirSync(binariesDir, { recursive: true })
  const dest = join(binariesDir, `ripmail-${triple}`)
  try {
    if (existsSync(dest)) unlinkSync(dest)
  } catch {
    // ignore
  }
  copyFileSync(ripmailPath, dest)
  chmodSync(dest, 0o755)
  console.log(`[link-ripmail-sidecar] copied ${ripmailPath} -> ${dest}`)
}

main()
