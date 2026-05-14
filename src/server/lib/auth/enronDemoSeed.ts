import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getEnronDemoUserKeyByTenantId } from './enronDemo.js'

type SeedPhase = 'idle' | 'downloading' | 'seeding' | 'failed'

type Manifest = {
  sourceUrl?: string
  expectedSha256?: string
}

type TenantSeedState = {
  inflight: Promise<void> | null
  runStartedAt: number | null
  phase: SeedPhase
  lastError: string | null
}

const tenantSeedState = new Map<string, TenantSeedState>()

function stateFor(tenantUserId: string): TenantSeedState {
  let s = tenantSeedState.get(tenantUserId)
  if (!s) {
    s = { inflight: null, runStartedAt: null, phase: 'idle', lastError: null }
    tenantSeedState.set(tenantUserId, s)
  }
  return s
}

/** Written after a successful full seed; prevents re-ingest on every demo login when mail DB already exists. */
export const ENRON_DEMO_PROVISIONED_FILENAME = 'enron-demo-provisioned.json'

export function resetEnronDemoSeedStateForTests(): void {
  tenantSeedState.clear()
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

/**
 * True once the demo tenant has been provisioned: non-empty mail index and/or provision marker.
 * Marker avoids re-running ingest when `ripmail.db` is missing transiently; use GET reseed to wipe+rebuild.
 */
export function isEnronDemoTenantProvisioned(tenantHomeDir: string): boolean {
  if (existsSync(join(tenantHomeDir, ENRON_DEMO_PROVISIONED_FILENAME))) return true
  return isEnronDemoTenantReady(tenantHomeDir)
}

export function writeEnronDemoProvisionedMarker(tenantHomeDir: string): void {
  writeFileSync(
    join(tenantHomeDir, ENRON_DEMO_PROVISIONED_FILENAME),
    `${JSON.stringify({ provisionedAt: new Date().toISOString() })}\n`,
    'utf8',
  )
}

/** One-time: persist marker for tenants that already have mail data from before the marker existed. */
export function ensureProvisionedMarkerWhenMailReady(tenantHomeDir: string): void {
  if (!isEnronDemoTenantReady(tenantHomeDir)) return
  if (existsSync(join(tenantHomeDir, ENRON_DEMO_PROVISIONED_FILENAME))) return
  writeEnronDemoProvisionedMarker(tenantHomeDir)
}

export type EnronDemoSeedSnapshot =
  | { status: 'ready' }
  | { status: 'running'; phase: Exclude<SeedPhase, 'idle' | 'failed'>; startedAt: number }
  | { status: 'failed'; message: string; startedAt: number | null }
  | { status: 'idle' }

export function getEnronDemoSeedSnapshot(
  tenantHomeDir: string,
  tenantUserId: string,
): EnronDemoSeedSnapshot {
  if (isEnronDemoTenantReady(tenantHomeDir)) return { status: 'ready' }
  const s = stateFor(tenantUserId)
  if (s.inflight) {
    const p = s.phase === 'downloading' || s.phase === 'seeding' ? s.phase : 'seeding'
    return { status: 'running', phase: p, startedAt: s.runStartedAt ?? Date.now() }
  }
  if (s.lastError) {
    return { status: 'failed', message: s.lastError, startedAt: s.runStartedAt }
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

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const rs = createReadStream(path)
  for await (const chunk of rs) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/** Same basename + cache dirs as `scripts/eval/ensureEnronTarball.mjs` (CLI / `npm run brain:seed-enron-demo`). */
export const ENRON_MAIL_TARBALL_BASENAME = 'enron_mail_20150507.tar.gz'

export function enronSharedTarballCachePathCandidates(repoRoot: string): string[] {
  const e = ENRON_MAIL_TARBALL_BASENAME
  return [
    join(repoRoot, 'data', '.cache', 'enron', e),
    join(repoRoot, 'data-eval', '.cache', 'enron', e),
  ]
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

  for (const sharedCache of enronSharedTarballCachePathCandidates(repoRoot)) {
    if (!existsSync(sharedCache)) continue
    const sha = await sha256File(sharedCache)
    if (sha === expectedSha) {
      return sharedCache
    }
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

function runSeedScript(
  repoRoot: string,
  tarPath: string,
  dataRoot: string,
  tenantId: string,
  demoUserKey: string,
  force: boolean,
): Promise<void> {
  const script = join(repoRoot, 'scripts/brain/seed-enron-demo-tenant.mjs')
  if (!existsSync(script)) {
    return Promise.reject(new Error(`Seed script missing: ${script}`))
  }

  const env = {
    ...process.env,
    BRAIN_DATA_ROOT: dataRoot,
    BRAIN_SEED_REPO_ROOT: repoRoot,
    BRAIN_ENRON_DEMO_TENANT_ID: tenantId,
    BRAIN_ENRON_DEMO_USER: demoUserKey,
    EVAL_ENRON_TAR: tarPath,
  }

  const args = [script, ...(force ? (['--force'] as const) : [])]

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
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

async function runEnronDemoSeedJob(
  dataRoot: string,
  tenantUserId: string,
  options: { force: boolean } = { force: false },
): Promise<void> {
  const { force } = options
  const s = stateFor(tenantUserId)
  const demoUserKey = getEnronDemoUserKeyByTenantId(tenantUserId)
  if (!demoUserKey) {
    throw new Error(`No Enron demo registry entry for tenant ${tenantUserId}`)
  }

  s.lastError = null
  s.phase = 'downloading'
  const repoRoot = resolveSeedRepoRoot()
  const tarPath = await ensureTarball(repoRoot)
  s.phase = 'seeding'
  await runSeedScript(repoRoot, tarPath, dataRoot, tenantUserId, demoUserKey, force)
  s.phase = 'idle'
  s.runStartedAt = null
  const home = join(dataRoot, tenantUserId)
  if (!isEnronDemoTenantReady(home)) {
    throw new Error('Seed finished but ripmail.db is still missing or empty.')
  }
  writeEnronDemoProvisionedMarker(home)
}

export type EnronDemoForceReseedStart = 'started' | 'busy'

/** Wipes the demo tenant (see seed script `--force`) and rebuilds mail + wiki layout from the Enron tarball. */
export function startEnronDemoForceReseed(dataRoot: string, tenantUserId: string): EnronDemoForceReseedStart {
  const s = stateFor(tenantUserId)
  if (s.inflight) return 'busy'

  s.lastError = null
  s.runStartedAt = Date.now()
  s.phase = 'downloading'
  s.inflight = runEnronDemoSeedJob(dataRoot, tenantUserId, { force: true })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      s.lastError = msg
      s.phase = 'failed'
    })
    .finally(() => {
      s.inflight = null
      if (!s.lastError) {
        s.phase = 'idle'
        s.runStartedAt = null
      }
    })
  return 'started'
}
