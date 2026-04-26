import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { enronDemoTenantUserId } from './enronDemo.js'

type SeedPhase = 'idle' | 'downloading' | 'seeding' | 'failed'

type Manifest = {
  sourceUrl?: string
  expectedSha256?: string
}

let inflight: Promise<void> | null = null
let runStartedAt: number | null = null
let phase: SeedPhase = 'idle'
let lastError: string | null = null

export function resetEnronDemoSeedStateForTests(): void {
  inflight = null
  runStartedAt = null
  phase = 'idle'
  lastError = null
}

export function isEnronDemoTenantReady(tenantHomeDir: string): boolean {
  const db = join(tenantHomeDir, 'ripmail', 'ripmail.db')
  try {
    if (!existsSync(db)) return false
    return statSync(db).size > 0
  } catch {
    return false
  }
}

export type EnronDemoSeedSnapshot =
  | { status: 'ready' }
  | { status: 'running'; phase: Exclude<SeedPhase, 'idle' | 'failed'>; startedAt: number }
  | { status: 'failed'; message: string; startedAt: number | null }
  | { status: 'idle' }

export function getEnronDemoSeedSnapshot(tenantHomeDir: string): EnronDemoSeedSnapshot {
  if (isEnronDemoTenantReady(tenantHomeDir)) return { status: 'ready' }
  if (inflight) {
    const p = phase === 'downloading' || phase === 'seeding' ? phase : 'seeding'
    return { status: 'running', phase: p, startedAt: runStartedAt ?? Date.now() }
  }
  if (lastError) {
    return { status: 'failed', message: lastError, startedAt: runStartedAt }
  }
  return { status: 'idle' }
}

function resolveSeedRepoRoot(): string {
  const env = process.env.BRAIN_SEED_REPO_ROOT?.trim()
  if (env && existsSync(join(env, 'eval/fixtures/enron-kean-manifest.json'))) {
    return env
  }
  const docker = join(process.cwd(), 'seed-enron')
  if (existsSync(join(docker, 'eval/fixtures/enron-kean-manifest.json'))) {
    return docker
  }
  const cwd = process.cwd()
  if (existsSync(join(cwd, 'eval/fixtures/enron-kean-manifest.json'))) {
    return cwd
  }
  throw new Error(
    'Cannot find enron-kean-manifest.json (set BRAIN_SEED_REPO_ROOT to repo or /app/seed-enron).',
  )
}

function loadManifest(repoRoot: string): Manifest {
  const raw = readFileSync(join(repoRoot, 'eval/fixtures/enron-kean-manifest.json'), 'utf8')
  return JSON.parse(raw) as Manifest
}

function resolveRipmailBinForSeed(repoRoot: string): string {
  const env = process.env.RIPMAIL_BIN?.trim()
  if (env) return env
  for (const p of [
    join(repoRoot, 'target/release/ripmail'),
    join(repoRoot, 'target/debug/ripmail'),
  ]) {
    if (existsSync(p)) return p
  }
  return 'ripmail'
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const rs = createReadStream(path)
  for await (const chunk of rs) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function ensureTarball(repoRoot: string): Promise<string> {
  const pre = process.env.EVAL_ENRON_TAR?.trim()
  if (pre && existsSync(pre)) {
    return pre
  }

  const manifest = loadManifest(repoRoot)
  const url =
    process.env.ENRON_SOURCE_URL?.trim() || manifest.sourceUrl || ''
  const expectedSha =
    process.env.ENRON_SHA256?.trim() || manifest.expectedSha256 || ''
  if (!url || !expectedSha) {
    throw new Error('Missing Enron tarball URL or SHA (manifest or ENRON_SOURCE_URL / ENRON_SHA256).')
  }

  const cacheDir = join(tmpdir(), 'brain-enron-tar-cache')
  mkdirSync(cacheDir, { recursive: true })
  const cachePath = join(cacheDir, `${expectedSha.slice(0, 16)}_enron_mail.tar.gz`)

  if (existsSync(cachePath)) {
    const sha = await sha256File(cachePath)
    if (sha !== expectedSha) {
      throw new Error('Cached Enron tarball SHA mismatch; delete cache file and retry.')
    }
    return cachePath
  }

  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`Enron download failed: HTTP ${res.status}`)
  }
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(cachePath))

  const sha = await sha256File(cachePath)
  if (sha !== expectedSha) {
    throw new Error('Downloaded Enron tarball SHA mismatch.')
  }
  return cachePath
}

function runSeedScript(repoRoot: string, tarPath: string, dataRoot: string, tenantId: string): Promise<void> {
  const script = join(repoRoot, 'scripts/brain/seed-enron-demo-tenant.mjs')
  if (!existsSync(script)) {
    return Promise.reject(new Error(`Seed script missing: ${script}`))
  }

  const ripmailBin = resolveRipmailBinForSeed(repoRoot)
  const env = {
    ...process.env,
    BRAIN_DATA_ROOT: dataRoot,
    BRAIN_SEED_REPO_ROOT: repoRoot,
    BRAIN_ENRON_DEMO_TENANT_ID: tenantId,
    EVAL_ENRON_TAR: tarPath,
    RIPMAIL_BIN: ripmailBin,
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let errBuf = ''
    child.stderr?.on('data', (c: Buffer) => {
      errBuf += c.toString('utf8')
      if (errBuf.length > 8000) errBuf = errBuf.slice(-8000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(errBuf.trim() || `seed exited ${code}`))
    })
  })
}

async function runEnronDemoSeedJob(dataRoot: string, tenantUserId: string): Promise<void> {
  lastError = null
  phase = 'downloading'
  const repoRoot = resolveSeedRepoRoot()
  const tarPath = await ensureTarball(repoRoot)
  phase = 'seeding'
  await runSeedScript(repoRoot, tarPath, dataRoot, tenantUserId)
  phase = 'idle'
  runStartedAt = null
  if (!isEnronDemoTenantReady(join(dataRoot, tenantUserId))) {
    throw new Error('Seed finished but ripmail.db is still missing or empty.')
  }
}

/**
 * Starts a background Enron demo ingest if none is running. Errors are stored for {@link getEnronDemoSeedSnapshot}.
 */
export function startEnronDemoSeedIfNeeded(dataRoot: string, tenantUserId?: string): void {
  const tid = tenantUserId ?? enronDemoTenantUserId()
  const home = join(dataRoot, tid)
  if (isEnronDemoTenantReady(home)) return
  if (inflight) return

  lastError = null
  runStartedAt = Date.now()
  phase = 'downloading'
  inflight = runEnronDemoSeedJob(dataRoot, tid)
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      lastError = msg
      phase = 'failed'
    })
    .finally(() => {
      inflight = null
      if (!lastError) {
        phase = 'idle'
        runStartedAt = null
      }
    })
}
