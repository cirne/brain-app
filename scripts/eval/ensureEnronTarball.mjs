/**
 * Resolve a verified `enron_mail_20150507.tar.gz` path for eval / demo seed.
 *
 * Resolution order:
 * 1. `EVAL_ENRON_TAR` — if set and the file exists, SHA must match the manifest (or `ENRON_SHA256` override).
 * 2. `<repoRoot>/.cache/enron/` — use if present; else move from legacy `data-eval` / `data` caches (SHA match).
 * 3. Download from `ENRON_SOURCE_URL` or `manifest.sourceUrl` into primary cache (`.part` + rename), then verify SHA.
 *
 * Download: prefers **`curl`** (HTTP/1.1, retries, **resume** via `-C -`). Set `EVAL_ENRON_USE_NODE_FETCH=1` for Node fetch.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, unlinkSync, createWriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  enronTarballPrimaryDir,
  enronTarballPrimaryPath,
  resolveOrMigrateEnronTarball,
} from './enronTarballCache.mjs'
import { sha256File } from './evalBrainCommon.mjs'

function curlUsable() {
  if (process.env.EVAL_ENRON_USE_NODE_FETCH === '1') return false
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} url
 * @param {string} partPath
 */
function downloadWithCurl(url, partPath) {
  console.error('[eval:enron-tar] Downloading with curl (resume if .part exists, ~1.7 GiB) …')
  execFileSync(
    'curl',
    [
      '-fL',
      '--retry',
      '5',
      '--retry-delay',
      '2',
      '--connect-timeout',
      '30',
      '--http1.1',
      '-C',
      '-',
      '--progress-bar',
      '-o',
      partPath,
      url,
    ],
    { stdio: 'inherit' },
  )
}

/**
 * @param {string} url
 * @param {string} partPath
 */
async function downloadWithNodeFetch(url, partPath) {
  console.error('[eval:enron-tar] Downloading with Node fetch (no resume) …')
  if (existsSync(partPath)) {
    try {
      unlinkSync(partPath)
    } catch {
      /* */
    }
  }
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    console.error('[eval:enron-tar] Download failed: HTTP', res.status, res.statusText)
    process.exit(1)
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partPath))
}

/**
 * @param {object} opts
 * @param {{ expectedSha256: string, sourceUrl?: string }} opts.manifest from enron-kean-manifest.json
 * @param {string} opts.repoRoot brain-app repo root
 * @returns {Promise<string>} absolute path to tarball
 */
export async function ensureEnronTarballPath({ manifest, repoRoot }) {
  const expectedSha =
    process.env.ENRON_SHA256?.trim() || manifest.expectedSha256 || ''
  if (!expectedSha) {
    throw new Error('[eval:enron-tar] manifest.expectedSha256 is missing')
  }

  const envTar = process.env.EVAL_ENRON_TAR?.trim()
  if (envTar) {
    const p = resolve(envTar)
    if (!existsSync(p)) {
      console.error('[eval:enron-tar] EVAL_ENRON_TAR not found:', p)
      process.exit(1)
    }
    const got = sha256File(p)
    if (got !== expectedSha) {
      console.error('[eval:enron-tar] EVAL_ENRON_TAR SHA-256 mismatch.\n  expected', expectedSha, '\n  got     ', got)
      process.exit(1)
    }
    console.error('[eval:enron-tar] Using EVAL_ENRON_TAR=', p)
    return p
  }

  const cached = resolveOrMigrateEnronTarball(repoRoot, expectedSha)
  if (cached) {
    console.error('[eval:enron-tar] Using cached tarball:', cached)
    return cached
  }

  mkdirSync(enronTarballPrimaryDir(repoRoot), { recursive: true })
  const primary = enronTarballPrimaryPath(repoRoot)

  const url = process.env.ENRON_SOURCE_URL?.trim() || manifest.sourceUrl || ''
  if (!url) {
    console.error(
      '[eval:enron-tar] No tarball on disk. Set EVAL_ENRON_TAR, or add sourceUrl to enron-kean-manifest.json, or ENRON_SOURCE_URL.',
    )
    process.exit(1)
  }

  console.error('[eval:enron-tar] Target:', primary)
  const part = `${primary}.part`

  try {
    if (curlUsable()) {
      downloadWithCurl(url, part)
    } else {
      await downloadWithNodeFetch(url, part)
    }
  } catch (e) {
    console.error('[eval:enron-tar] Download failed:', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  const got = sha256File(part)
  if (got !== expectedSha) {
    console.error('[eval:enron-tar] Downloaded file SHA-256 mismatch.\n  expected', expectedSha, '\n  got     ', got)
    try {
      unlinkSync(part)
    } catch {
      /* */
    }
    process.exit(1)
  }

  renameSync(part, primary)
  console.error('[eval:enron-tar] Verified and saved:', primary)
  return primary
}
