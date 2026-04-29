#!/usr/bin/env node
/**
 * Build eval home with the Enron kean-s mailbox (tens of thousands of messages, all as .eml for ripmail).
 *
 * Usage: node scripts/eval/build-enron-kean.mjs [--force]
 *
 * Tarball:
 * - If `EVAL_ENRON_TAR` is set → use that path (SHA must match the manifest).
 * - Else → use `data-eval/.cache/enron/enron_mail_20150507.tar.gz`, downloading from
 *   `eval/fixtures/enron-kean-manifest.json` `sourceUrl` on first run (~1.7 GiB).
 * - Override download URL / SHA with `ENRON_SOURCE_URL` / `ENRON_SHA256` if needed.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureEnronTarballPath } from './ensureEnronTarball.mjs'
import { ingestEnronKeanToBrainRoot, loadEnronKeanManifest } from './enronKeanIngest.mjs'
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

async function main() {
  const manifest = loadEnronKeanManifest(manifestPath)
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

  const tarPath = await ensureEnronTarballPath({ manifest, repoRoot: root })
  const { fileCount } = ingestEnronKeanToBrainRoot({
    manifest,
    tarPath,
    brainRoot: brain,
    ripmailBin,
    extractParent,
    force,
  })
  writeStamp(manifest, v, fileCount)
  console.error('[eval:enron-kean] Done. BRAIN_HOME=', brain)
  console.error('  Try: RIPMAIL_HOME=' + ripHome + ' ' + ripmailBin + ' status --json')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
