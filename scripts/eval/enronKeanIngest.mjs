/**
 * Shared Enron maildir → Brain ripmail layout (extract, .eml flatten, rebuild-index).
 * Used by `scripts/brain/seed-enron-demo-tenant.mjs` (demo tenants + eval mail corpus).
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  ensureEvalBrainDirs,
  runRebuildIndex,
  sha256File,
  writeRipmailEvalFixture,
} from './evalBrainCommon.mjs'

/**
 * @param {string} dir
 * @yields {string}
 */
export function* walkMailFiles(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      yield* walkMailFiles(p)
    } else if (ent.isFile()) {
      yield p
    }
  }
}

/**
 * @param {object} manifest
 * @param {string} manifest.expectedSha256
 * @param {string} manifest.pathInsideArchive
 * @param {string} manifest.sourceUser
 * @param {string} manifest.mailboxId
 * @param {string} manifest.accountEmail
 * @param {string} tarPath
 * @param {string} brainRoot Brain home (multi-tenant tenant dir under BRAIN_DATA_ROOT, or explicit BRAIN_HOME)
 * @param {string} ripmailBin
 * @param {string} extractParent Directory under which `tar -xzf … pathInsideArchive` is extracted (e.g. …/expand)
 * @param {boolean} force
 * @returns {{ fileCount: number }}
 */
export function ingestEnronMailboxToBrainRoot({
  manifest,
  tarPath,
  brainRoot,
  ripmailBin,
  extractParent,
  force,
}) {
  if (!existsSync(tarPath)) {
    console.error('[enron-mailbox-ingest] Tar not found:', tarPath)
    process.exit(1)
  }
  const got = sha256File(tarPath)
  if (got !== manifest.expectedSha256) {
    console.error(
      '[enron-mailbox-ingest] SHA-256 mismatch.\n  expected',
      manifest.expectedSha256,
      '\n  got     ',
      got,
    )
    process.exit(1)
  }
  console.error('[enron-mailbox-ingest] Using', tarPath)

  const ripHome = join(brainRoot, 'ripmail')
  mkdirSync(extractParent, { recursive: true })
  if (force && existsSync(join(extractParent, 'maildir'))) {
    try {
      rmSync(join(extractParent, 'maildir'), { recursive: true, force: true })
    } catch {
      /* */
    }
  }

  const inner = manifest.pathInsideArchive
  console.error('[enron-mailbox-ingest] Extracting', inner, 'from tarball …')
  execFileSync('tar', ['-xzf', tarPath, '-C', extractParent, inner], { stdio: 'inherit' })

  const userRoot = join(extractParent, inner)
  if (!existsSync(userRoot)) {
    console.error('[enron-mailbox-ingest] Expected', userRoot, 'after tar extract')
    process.exit(1)
  }

  const cur = join(ripHome, manifest.mailboxId, 'maildir', 'cur')
  if (existsSync(cur)) {
    console.error('[enron-mailbox-ingest] Clearing', cur)
    rmSync(cur, { recursive: true, force: true })
  }
  mkdirSync(cur, { recursive: true })

  const all = [...walkMailFiles(userRoot)].sort()
  console.error('[enron-mailbox-ingest] Copying', all.length, 'messages to', cur, 'as .eml …')
  for (let i = 0; i < all.length; i++) {
    const name = `${String(i + 1).padStart(7, '0')}.eml`
    copyFileSync(all[i], join(cur, name))
    if (i > 0 && i % 5000 === 0) {
      console.error(`[enron-mailbox-ingest] … ${i} / ${all.length}`)
    }
  }

  writeRipmailEvalFixture(ripHome, { mailboxId: manifest.mailboxId, accountEmail: manifest.accountEmail })
  ensureEvalBrainDirs(brainRoot)

  if (force) {
    for (const f of ['ripmail.db', 'ripmail.db-wal', 'ripmail.db-shm']) {
      const p = join(ripHome, f)
      if (existsSync(p)) {
        try {
          rmSync(p)
        } catch {
          /* */
        }
      }
    }
  }

  runRebuildIndex(ripmailBin, { ripHome, brain: brainRoot })
  return { fileCount: all.length }
}

/**
 * @param {string} manifestPath
 */
export function loadEnronMailboxManifest(manifestPath) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!m.expectedSha256 || !m.pathInsideArchive || !m.sourceUser || !m.mailboxId || !m.accountEmail) {
    throw new Error(`Invalid Enron manifest: ${manifestPath}`)
  }
  return m
}

/** @deprecated Use {@link ingestEnronMailboxToBrainRoot}. */
export const ingestEnronKeanToBrainRoot = ingestEnronMailboxToBrainRoot

/** @deprecated Use {@link loadEnronMailboxManifest}. */
export const loadEnronKeanManifest = loadEnronMailboxManifest
