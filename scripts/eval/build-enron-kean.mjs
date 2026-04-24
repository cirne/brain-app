#!/usr/bin/env node
/**
 * Build eval home with the Enron kean-s mailbox (tens of thousands of messages, all as .eml for ripmail).
 *
 * Usage: node scripts/eval/build-enron-kean.mjs [--force]
 * Env:   EVAL_ENRON_TAR=/path/to/enron_mail_20150507.tar.gz (default: ~/Downloads/enron_mail_20150507.tar.gz)
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureEvalBrainDirs, runRebuildIndex, sha256File, writeRipmailEvalFixture } from './evalBrainCommon.mjs'
import { repoRoot, resolveRipmailBin, ripmailVersionLine } from './ripmailBin.mjs'

const root = repoRoot
const manifestPath = join(root, 'eval/fixtures/enron-kean-manifest.json')
const dataEval = join(root, 'data-eval')
const brain = join(dataEval, 'brain')
const ripHome = join(brain, 'ripmail')
const cacheDir = join(dataEval, '.cache', 'enron')
const extractParent = join(cacheDir, 'expand')
const stampPath = join(dataEval, '.enron-kean-stamp.json')
const force = process.argv.includes('--force')

function loadManifest() {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!m.expectedSha256 || !m.pathInsideArchive || !m.sourceUser || !m.mailboxId || !m.accountEmail) {
    throw new Error('Invalid enron-kean-manifest.json')
  }
  return m
}

/**
 * @param {string} dir
 * @yields {string}
 */
function* walkFiles(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      yield* walkFiles(p)
    } else if (ent.isFile()) {
      yield p
    }
  }
}

function defaultTarPath() {
  return join(homedir(), 'Downloads', 'enron_mail_20150507.tar.gz')
}

function writeStamp(manifest, versionLine, fileCount) {
  const payload = {
    kind: 'enron-kean-s',
    manifestExpectedSha256: manifest.expectedSha256,
    sourceUser: manifest.sourceUser,
    sourceUrl: manifest.sourceUrl,
    ripmailVersion: versionLine,
    fileCount,
    rebuiltAt: new Date().toISOString(),
  }
  writeFileSync(stampPath, JSON.stringify(payload, null, 2), 'utf8')
  console.error('[eval:enron-kean] Wrote', stampPath)
}

function isStampFresh(manifest, versionLine) {
  if (force) return false
  if (!existsSync(stampPath) || !existsSync(join(ripHome, 'ripmail.db'))) return false
  try {
    const s = JSON.parse(readFileSync(stampPath, 'utf8'))
    if (s.kind !== 'enron-kean-s') return false
    if (s.manifestExpectedSha256 !== manifest.expectedSha256) return false
    if (s.ripmailVersion !== versionLine) return false
    if (s.sourceUser !== manifest.sourceUser) return false
    return statSync(join(ripHome, 'ripmail.db')).size > 0
  } catch {
    return false
  }
}

function main() {
  const manifest = loadManifest()
  const ripmailBin = resolveRipmailBin(root)
  const v = ripmailVersionLine(ripmailBin)
  if (v.startsWith('unknown')) {
    console.error('[eval:enron-kean] Build ripmail: cargo build -p ripmail --release')
    process.exit(1)
  }

  if (isStampFresh(manifest, v)) {
    console.error('[eval:enron-kean] Up to date (use --force to rebuild):', brain)
    return
  }

  const tarPath = resolve(process.env.EVAL_ENRON_TAR?.trim() || defaultTarPath())
  if (!existsSync(tarPath)) {
    console.error('[eval:enron-kean] Tar not found:', tarPath, '\n  Set EVAL_ENRON_TAR=...')
    process.exit(1)
  }
  const got = sha256File(tarPath)
  if (got !== manifest.expectedSha256) {
    console.error('[eval:enron-kean] SHA-256 mismatch.\n  expected', manifest.expectedSha256, '\n  got     ', got)
    process.exit(1)
  }
  console.error('[eval:enron-kean] Using', tarPath)

  mkdirSync(extractParent, { recursive: true })
  if (force && existsSync(join(extractParent, 'maildir'))) {
    try {
      rmSync(join(extractParent, 'maildir'), { recursive: true, force: true })
    } catch { /* */ }
  }

  const inner = manifest.pathInsideArchive
  console.error('[eval:enron-kean] Extracting', inner, 'from tarball (one-time, large)...')
  execFileSync('tar', ['-xzf', tarPath, '-C', extractParent, inner], { stdio: 'inherit' })

  const userRoot = join(extractParent, inner)
  if (!existsSync(userRoot)) {
    console.error('[eval:enron-kean] Expected', userRoot, 'after tar extract')
    process.exit(1)
  }

  const cur = join(ripHome, manifest.mailboxId, 'maildir', 'cur')
  if (existsSync(cur)) {
    console.error('[eval:enron-kean] Clearing', cur)
    rmSync(cur, { recursive: true, force: true })
  }
  mkdirSync(cur, { recursive: true })

  const all = [...walkFiles(userRoot)].sort()
  console.error('[eval:enron-kean] Copying', all.length, 'messages to', cur, 'as .eml …')
  for (let i = 0; i < all.length; i++) {
    const name = `${String(i + 1).padStart(7, '0')}.eml`
    copyFileSync(all[i], join(cur, name))
    if (i > 0 && i % 5000 === 0) {
      console.error(`[eval:enron-kean] … ${i} / ${all.length}`)
    }
  }

  writeRipmailEvalFixture(ripHome, { mailboxId: manifest.mailboxId, accountEmail: manifest.accountEmail })
  ensureEvalBrainDirs(brain)

  if (force) {
    for (const f of ['ripmail.db', 'ripmail.db-wal', 'ripmail.db-shm']) {
      const p = join(ripHome, f)
      if (existsSync(p)) {
        try {
          rmSync(p)
        } catch { /* */ }
      }
    }
  }

  runRebuildIndex(ripmailBin, { ripHome, brain })
  writeStamp(manifest, v, all.length)
  console.error('[eval:enron-kean] Done. BRAIN_HOME=', brain)
  console.error('  Try: RIPMAIL_HOME=' + ripHome + ' ' + ripmailBin + ' status --json')
}

main()
