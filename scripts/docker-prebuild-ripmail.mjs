#!/usr/bin/env node
/**
 * Produce a Linux ELF `ripmail` at `.docker/linux-ripmail/ripmail` for the Dockerfile COPY.
 *
 * - On **Linux** hosts whose CPU matches the Docker daemon's default linux arch: runs `cargo build`
 *   on the host (fast, incremental `target/release/`).
 * - Otherwise: `docker run rust:bookworm` with the repo bind-mounted and named Cargo registry/git
 *   volumes (still faster than baking compile into the app image layers; deps stay cached).
 *
 * Override platform: `DOCKER_PLATFORM=linux/amd64 node scripts/docker-prebuild-ripmail.mjs`
 */
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.docker/linux-ripmail')
const outBin = join(outDir, 'ripmail')

function dockerServerPlatform() {
  const fromEnv = process.env.DOCKER_PLATFORM?.trim()
  if (fromEnv) return fromEnv
  try {
    const os = execSync('docker version -f {{.Server.Os}}', { encoding: 'utf-8' }).trim()
    const arch = execSync('docker version -f {{.Server.Arch}}', { encoding: 'utf-8' }).trim()
    return `${os}/${arch}`
  } catch {
    console.error('[docker-prebuild-ripmail] Could not read `docker version`. Is Docker running?')
    process.exit(1)
  }
}

/** Normalize Docker arch to arm64 | amd64 */
function normalizedDockerArch(platform) {
  const arch = platform.split('/')[1]?.toLowerCase()
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  if (arch === 'amd64' || arch === 'x86_64') return 'amd64'
  return arch ?? ''
}

/** Host Linux + same arch as Docker linux VM → native cargo is a Linux ELF for that arch. */
function canBuildRipmailWithHostCargo(platform) {
  if (process.platform !== 'linux') return false
  const da = normalizedDockerArch(platform)
  const host = process.arch === 'x64' ? 'amd64' : process.arch
  return da === host
}

function buildOnHost() {
  execSync('cargo build -p ripmail --release', { cwd: root, stdio: 'inherit' })
  const built = join(root, 'target/release/ripmail')
  if (!existsSync(built)) {
    console.error('[docker-prebuild-ripmail] Missing', built)
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  copyFileSync(built, outBin)
  chmodSync(outBin, 0o755)
  console.log('[docker-prebuild-ripmail] host cargo →', outBin)
}

function buildInRustContainer(platform) {
  mkdirSync(outDir, { recursive: true })
  // Use `bash -c`, not `bash -lc`: a login shell sources /etc/profile and resets PATH without
  // /usr/local/cargo/bin, so `cargo` disappears in rust:bookworm.
  const inner = `set -euo pipefail
export PATH="/usr/local/cargo/bin:\${PATH}"
apt-get update -qq
apt-get install -y --no-install-recommends pkg-config libssl-dev >/dev/null
mkdir -p /build/.docker/linux-ripmail
cargo build -p ripmail --release
install -m 755 target/release/ripmail /build/.docker/linux-ripmail/ripmail
echo "[docker-prebuild-ripmail] container cargo → /build/.docker/linux-ripmail/ripmail"
`
  const args = [
    'run',
    '--rm',
    '--platform',
    platform,
    '-v',
    `${root}:/build`,
    '-w',
    '/build',
    '-v',
    'brain-app-ripmail-registry:/usr/local/cargo/registry',
    '-v',
    'brain-app-ripmail-git:/usr/local/cargo/git',
    'rust:bookworm',
    'bash',
    '-c',
    inner,
  ]
  const r = spawnSync('docker', args, { stdio: 'inherit' })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
  if (!existsSync(outBin)) {
    console.error('[docker-prebuild-ripmail] Expected binary missing:', outBin)
    process.exit(1)
  }
}

const platform = dockerServerPlatform()
if (!platform.startsWith('linux/')) {
  console.error('[docker-prebuild-ripmail] Expected linux/* Docker server, got:', platform)
  process.exit(1)
}

if (canBuildRipmailWithHostCargo(platform)) {
  buildOnHost()
} else {
  console.log(
    '[docker-prebuild-ripmail] Host is not Linux matching Docker arch; building ripmail in rust:bookworm (',
    platform,
    ')…',
  )
  buildInRustContainer(platform)
}
