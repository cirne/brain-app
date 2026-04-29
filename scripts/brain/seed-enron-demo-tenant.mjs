#!/usr/bin/env node
/**
 * Seed or rebuild the OPP-051 Enron demo tenant under BRAIN_DATA_ROOT (multi-tenant layout).
 *
 * Run from repo root (development / host with Docker volume bind-mount), or in-container via:
 *   node /app/seed-enron/scripts/brain/seed-enron-demo-tenant.mjs
 *
 * Required env:
 *   BRAIN_DATA_ROOT — tenant parent (e.g. ./data-multitenant or /brain-data in Docker)
 *
 * Tarball: same as `npm run eval:build` — if `EVAL_ENRON_TAR` is unset, downloads to
 *   `data-eval/.cache/enron/enron_mail_20150507.tar.gz` (see scripts/eval/ensureEnronTarball.mjs).
 *
 * Optional:
 *   EVAL_ENRON_TAR — use this path instead of cache (SHA checked via manifest)
 *   BRAIN_ENRON_DEMO_TENANT_ID — default usr_enrondemo00000000001
 *   RIPMAIL_BIN — default: repo target/release, else PATH ripmail (container: /usr/local/bin/ripmail)
 *   BRAIN_SEED_REPO_ROOT — override repo root for eval/fixtures path (normally auto from script location)
 *   ENRON_SOURCE_URL / ENRON_SHA256 — override manifest URL or hash (air-gapped mirrors)
 *
 * Flags:
 *   --force — remove existing tenant dir and rebuild from tarball
 *
 * If ripmail.db already exists and --force is not passed, exits 0 without changes.
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureEnronTarballPath } from '../eval/ensureEnronTarball.mjs'
import { ingestEnronKeanToBrainRoot, loadEnronKeanManifest } from '../eval/enronKeanIngest.mjs'
import { ripmailVersionLine, resolveRipmailBin } from '../eval/ripmailBin.mjs'

const wantForce = process.argv.includes('--force')

const dataRoot = process.env.BRAIN_DATA_ROOT?.trim()
if (!dataRoot) {
  console.error('[seed-enron-demo] Set BRAIN_DATA_ROOT (multi-tenant data root).')
  process.exit(1)
}

const TENANT_ID = process.env.BRAIN_ENRON_DEMO_TENANT_ID?.trim() || 'usr_enrondemo00000000001'
const tenantHome = join(dataRoot, TENANT_ID)

const repoRoot =
  process.env.BRAIN_SEED_REPO_ROOT?.trim() ||
  fileURLToPath(new URL('../..', import.meta.url))
const manifestPath = join(repoRoot, 'eval/fixtures/enron-kean-manifest.json')

if (!existsSync(manifestPath)) {
  console.error('[seed-enron-demo] Manifest not found:', manifestPath)
  console.error('  Set BRAIN_SEED_REPO_ROOT to the brain-app repo root, or run from the repo.')
  process.exit(1)
}

const ripDb = join(tenantHome, 'ripmail', 'ripmail.db')
if (!wantForce && existsSync(ripDb) && statSync(ripDb).size > 0) {
  console.error('[seed-enron-demo] Already seeded:', ripDb, '(use --force to rebuild)')
  process.exit(0)
}

if (wantForce && existsSync(tenantHome)) {
  console.error('[seed-enron-demo] Removing', tenantHome)
  rmSync(tenantHome, { recursive: true, force: true })
}

mkdirSync(dataRoot, { recursive: true })
mkdirSync(tenantHome, { recursive: true })

const ripmailBin = process.env.RIPMAIL_BIN?.trim() || resolveRipmailBin(repoRoot)
const v = ripmailVersionLine(ripmailBin)
if (v.startsWith('unknown')) {
  console.error('[seed-enron-demo] ripmail not runnable:', ripmailBin)
  process.exit(1)
}

const extractRoot = join(tmpdir(), 'brain-enron-seed', TENANT_ID)
if (existsSync(extractRoot)) {
  rmSync(extractRoot, { recursive: true, force: true })
}
const extractParent = join(extractRoot, 'expand')
mkdirSync(extractParent, { recursive: true })

const manifest = loadEnronKeanManifest(manifestPath)

async function main() {
  const tarPath = await ensureEnronTarballPath({ manifest, repoRoot })
  console.error('[seed-enron-demo] Ingesting Enron kean-s →', tenantHome)

  ingestEnronKeanToBrainRoot({
    manifest,
    tarPath,
    brainRoot: tenantHome,
    ripmailBin,
    extractParent,
    force: true,
  })

  const handleMeta = {
    userId: TENANT_ID,
    handle: 'enron-demo',
    confirmedAt: new Date().toISOString(),
  }
  writeFileSync(join(tenantHome, 'handle-meta.json'), JSON.stringify(handleMeta, null, 2), 'utf8')

  try {
    rmSync(extractRoot, { recursive: true, force: true })
  } catch {
    /* */
  }

  console.error('[seed-enron-demo] Done.', tenantHome)
}

main().catch(e => {
  console.error('[seed-enron-demo]', e)
  process.exit(1)
})
