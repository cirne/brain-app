#!/usr/bin/env node
/**
 * Seed or rebuild OPP-051 Enron demo tenant(s) under BRAIN_DATA_ROOT (multi-tenant layout).
 *
 * npm default (see package.json): `npm run brain:seed-enron-demo` seeds **all three** personas under `./data`.
 *
 * Required env:
 *   BRAIN_DATA_ROOT — tenant parent (e.g. ./data or /brain-data in Docker)
 *
 * Pick **one** demo user (see eval/fixtures/enron-demo-registry.json):
 *   BRAIN_ENRON_DEMO_USER=kean|lay|skilling
 * Or legacy: BRAIN_ENRON_DEMO_TENANT_ID=usr_enrondemo… (must match a registry row).
 *
 * Seed **all** registry demo tenants:
 *   node scripts/brain/seed-enron-demo-tenant.mjs --all
 *
 * Tarball: `EVAL_ENRON_TAR` or stable cache under `<repo>/data/.cache/enron/`.
 *
 * Flags:
 *   --force — remove existing tenant dir(s) and rebuild from tarball
 *   --all   — seed every user in enron-demo-registry.json (ignores BRAIN_ENRON_DEMO_USER)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureEnronTarballPath } from '../eval/ensureEnronTarball.mjs'
import { ingestEnronMailboxToBrainRoot, loadEnronMailboxManifest } from '../eval/enronKeanIngest.mjs'

const wantForce = process.argv.includes('--force')
const wantAll = process.argv.includes('--all')

const dataRoot = process.env.BRAIN_DATA_ROOT?.trim()
if (!dataRoot) {
  console.error('[seed-enron-demo] Set BRAIN_DATA_ROOT (multi-tenant data root).')
  process.exit(1)
}

const repoRoot =
  process.env.BRAIN_SEED_REPO_ROOT?.trim() ||
  fileURLToPath(new URL('../..', import.meta.url))

const registryPath = join(repoRoot, 'eval/fixtures/enron-demo-registry.json')
if (!existsSync(registryPath)) {
  console.error('[seed-enron-demo] Registry not found:', registryPath)
  console.error('  Set BRAIN_SEED_REPO_ROOT to the brain-app repo root, or run from the repo.')
  process.exit(1)
}

/** @returns {{ users: Array<{ key: string, label: string, tenantUserId: string, workspaceHandle: string, manifestFile: string }> }} */
function loadRegistry() {
  return JSON.parse(readFileSync(registryPath, 'utf8'))
}

function resolveSingleUser(registry) {
  const userKey = process.env.BRAIN_ENRON_DEMO_USER?.trim().toLowerCase()
  const tenantOverride = process.env.BRAIN_ENRON_DEMO_TENANT_ID?.trim()

  if (userKey) {
    const u = registry.users.find(x => x.key === userKey)
    if (!u) {
      console.error('[seed-enron-demo] Unknown BRAIN_ENRON_DEMO_USER:', userKey)
      console.error('  Expected one of:', registry.users.map(x => x.key).join(', '))
      process.exit(1)
    }
    return u
  }

  if (tenantOverride) {
    const u = registry.users.find(x => x.tenantUserId === tenantOverride)
    if (!u) {
      console.error('[seed-enron-demo] BRAIN_ENRON_DEMO_TENANT_ID does not match any demo user:', tenantOverride)
      process.exit(1)
    }
    return u
  }

  console.error('[seed-enron-demo] Set BRAIN_ENRON_DEMO_USER (kean|lay|skilling) or BRAIN_ENRON_DEMO_TENANT_ID, or pass --all.')
  process.exit(1)
}



/**
 * @param {{ key: string, tenantUserId: string, workspaceHandle: string, manifestFile: string }} entry
 */
async function seedOneTenant(entry) {
  const TENANT_ID = entry.tenantUserId
  const tenantHome = join(dataRoot, TENANT_ID)
  const manifestPath = join(repoRoot, 'eval/fixtures', entry.manifestFile)

  if (!existsSync(manifestPath)) {
    console.error('[seed-enron-demo] Manifest not found:', manifestPath)
    process.exit(1)
  }

  const ripDb = join(tenantHome, 'ripmail', 'ripmail.db')
  if (!wantForce && existsSync(ripDb) && statSync(ripDb).size > 0) {
    console.error('[seed-enron-demo] Already seeded:', ripDb, '(use --force to rebuild)')
    return
  }

  if (wantForce && existsSync(tenantHome)) {
    console.error('[seed-enron-demo] Removing', tenantHome)
    rmSync(tenantHome, { recursive: true, force: true })
  }

  mkdirSync(dataRoot, { recursive: true })
  mkdirSync(tenantHome, { recursive: true })

  const extractRoot = join(tmpdir(), 'brain-enron-seed', TENANT_ID)
  if (existsSync(extractRoot)) {
    rmSync(extractRoot, { recursive: true, force: true })
  }
  const extractParent = join(extractRoot, 'expand')
  mkdirSync(extractParent, { recursive: true })

  const manifest = loadEnronMailboxManifest(manifestPath)
  const tarPath = await ensureEnronTarballPath({ manifest, repoRoot })
  console.error('[seed-enron-demo] Ingesting Enron', entry.key, manifest.sourceUser, '→', tenantHome)

  ingestEnronMailboxToBrainRoot({
    manifest,
    tarPath,
    brainRoot: tenantHome,
    extractParent,
    force: true,
  })

  const handleMeta = {
    userId: TENANT_ID,
    handle: entry.workspaceHandle,
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

async function main() {
  const registry = loadRegistry()
  if (!registry.users?.length) {
    console.error('[seed-enron-demo] Empty registry:', registryPath)
    process.exit(1)
  }

  if (wantAll) {
    for (const entry of registry.users) {
      await seedOneTenant(entry)
    }
    return
  }

  const entry = resolveSingleUser(registry)
  await seedOneTenant(entry)
}

main().catch(e => {
  console.error('[seed-enron-demo]', e)
  process.exit(1)
})
