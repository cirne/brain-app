#!/usr/bin/env node
/**
 * Build eval home with the Enron kean-s mailbox (tens of thousands of messages, all as .eml for ripmail).
 *
 * Usage: node scripts/eval/build-enron-kean.mjs [--force]
 * Env:   EVAL_ENRON_TAR=/path/to/enron_mail_20150507.tar.gz (default: ~/Downloads/enron_mail_20150507.tar.gz)
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
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

function defaultTarPath() {
  return join(homedir(), 'Downloads', 'enron_mail_20150507.tar.gz')
}

function main() {
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

  const tarPath = resolve(process.env.EVAL_ENRON_TAR?.trim() || defaultTarPath())
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

main()
