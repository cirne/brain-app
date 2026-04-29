/**
 * Produce a Linux ELF `ripmail` at `.docker/linux-ripmail/ripmail` for the Dockerfile COPY.
 *
 * - On **Linux** hosts whose CPU matches the Docker daemon's default linux arch: runs `cargo build`
 *   on the host (fast, incremental `target/release/`).
 * - Otherwise: `docker run rust:bookworm` with the repo bind-mounted, Cargo registry/git volumes,
 *   and a **named volume for CARGO_TARGET_DIR** so Linux release artifacts survive `cargo clean` on
 *   the host and rebuild incrementally across publishes.
 *
 * When ripmail sources + lockfile are unchanged, skips the build and reuses the existing binary
 * (override: `DOCKER_RIPMAIL_FORCE=1`).
 *
 * Override platform: `DOCKER_PLATFORM=linux/amd64 npx tsx scripts/docker-prebuild-ripmail.ts`
 */
import { execSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeRipmailDockerInputsHash } from '../src/server/lib/ripmailDockerInputsHash'

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
function normalizedDockerArch(platform: string) {
  const arch = platform.split('/')[1]?.toLowerCase()
  if (arch === 'arm64' || arch === 'aarch64') return 'arm64'
  if (arch === 'amd64' || arch === 'x86_64') return 'amd64'
  return arch ?? ''
}

/** e.g. linux/amd64 → linux-amd64 */
function platformVolumeSlug(platform: string) {
  return platform.replace(/\//g, '-')
}

function stampPath(platform: string) {
  return join(outDir, `.inputs-hash-${platformVolumeSlug(platform)}`)
}

function shouldSkipBuild(platform: string, inputsHash: string): boolean {
  if (process.env.DOCKER_RIPMAIL_FORCE === '1') {
    return false
  }
  if (!existsSync(outBin)) {
    return false
  }
  const sp = stampPath(platform)
  if (!existsSync(sp)) {
    return false
  }
  try {
    const prev = readFileSync(sp, 'utf-8').trim()
    return prev === inputsHash
  } catch {
    return false
  }
}

function writeStamp(platform: string, inputsHash: string) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(stampPath(platform), `${inputsHash}\n`, 'utf-8')
}

/** Host Linux + same arch as Docker linux VM → native cargo is a Linux ELF for that arch. */
function canBuildRipmailWithHostCargo(platform: string) {
  if (process.platform !== 'linux') return false
  const da = normalizedDockerArch(platform)
  const host = process.arch === 'x64' ? 'amd64' : process.arch
  return da === host
}

function buildOnHost(platform: string, inputsHash: string) {
  execSync('cargo build -p ripmail --release', { cwd: root, stdio: 'inherit' })
  const built = join(root, 'target/release/ripmail')
  if (!existsSync(built)) {
    console.error('[docker-prebuild-ripmail] Missing', built)
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  copyFileSync(built, outBin)
  chmodSync(outBin, 0o755)
  writeStamp(platform, inputsHash)
  console.log('[docker-prebuild-ripmail] host cargo →', outBin)
}

function buildInRustContainer(platform: string, inputsHash: string) {
  mkdirSync(outDir, { recursive: true })
  const arch = normalizedDockerArch(platform)
  const targetVol = `brain-app-ripmail-target-${platformVolumeSlug(platform)}`

  // CARGO_TARGET_DIR on a named volume: survives host `cargo clean` and stays separate from macOS target/
  const inner = `set -euo pipefail
export PATH="/usr/local/cargo/bin:\${PATH}"
export CARGO_TARGET_DIR="/mnt/ripmail-target"
if ! dpkg -s libssl-dev >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends pkg-config libssl-dev >/dev/null
fi
mkdir -p /build/.docker/linux-ripmail
cargo build -p ripmail --release
install -m 755 /mnt/ripmail-target/release/ripmail /build/.docker/linux-ripmail/ripmail
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
    '-v',
    `${targetVol}:/mnt/ripmail-target`,
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
  writeStamp(platform, inputsHash)
  console.log('[docker-prebuild-ripmail] Linux target cache volume:', targetVol, `(${arch})`)
}

const platform = dockerServerPlatform()
if (!platform.startsWith('linux/')) {
  console.error('[docker-prebuild-ripmail] Expected linux/* Docker server, got:', platform)
  process.exit(1)
}

const inputsHash = computeRipmailDockerInputsHash(root)

if (shouldSkipBuild(platform, inputsHash)) {
  console.log(
    '[docker-prebuild-ripmail] Skipping rebuild (inputs unchanged). Set DOCKER_RIPMAIL_FORCE=1 to rebuild.',
    outBin,
  )
  process.exit(0)
}

if (canBuildRipmailWithHostCargo(platform)) {
  buildOnHost(platform, inputsHash)
} else {
  console.log(
    '[docker-prebuild-ripmail] Host is not Linux matching Docker arch; building ripmail in rust:bookworm (',
    platform,
    ')…',
  )
  buildInRustContainer(platform, inputsHash)
}
