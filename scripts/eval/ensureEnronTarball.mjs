/**
 * Resolve a verified `enron_mail_20150507.tar.gz` path for eval / demo seed.
 *
 * Resolution order:
 * 1. `EVAL_ENRON_TAR` — if set and the file exists, SHA must match the manifest (or `ENRON_SHA256` override).
 * 2. Stable caches (SHA match); see `enronSharedTarballCachePathCandidates` in `enronDemoSeed.ts` — same order:
 *    `<repoRoot>/data/.cache/enron/`, then legacy `<repoRoot>/data-eval/.cache/enron/`.
 * 3. Download from `ENRON_SOURCE_URL` or `manifest.sourceUrl` into the primary cache path (with `.part` + rename), then verify SHA.
 *
 * Download: prefers **`curl`** (HTTP/1.1, retries, **resume** via `-C -`) — much faster and more reliable on large
 * files than Node `fetch` streaming. Set `EVAL_ENRON_USE_NODE_FETCH=1` to force the old path. Partial `.part` files
 * are kept for resume (do not delete before re-running).
 *
 * Aligns tarball resolution with `enronDemoSeed` / CLI ingest, but persists under `data/.cache/`
 * so local downloads survive reboots without re-downloading.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
 * @param {string} opts.repoRoot brain-app repo root (contains eval/fixtures and data/.cache/enron/)
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

  const cacheDir = join(repoRoot, 'data', '.cache', 'enron')
  const baseName = 'enron_mail_20150507.tar.gz'
  const cacheCandidates = [
    join(cacheDir, baseName),
    join(repoRoot, 'data-eval', '.cache', 'enron', baseName),
  ]

  for (const cached of cacheCandidates) {
    if (!existsSync(cached)) continue
    const got = sha256File(cached)
    if (got === expectedSha) {
      console.error('[eval:enron-tar] Using cached tarball:', cached)
      return cached
    }
    console.error('[eval:enron-tar] Tarball SHA mismatch at', cached, '(trying other locations or re-download)')
  }

  mkdirSync(cacheDir, { recursive: true })
  const cached = join(cacheDir, baseName)
  if (existsSync(cached)) {
    try {
      rmSync(cached)
    } catch {
      /* */
    }
  }

  const url = process.env.ENRON_SOURCE_URL?.trim() || manifest.sourceUrl || ''
  if (!url) {
    console.error(
      '[eval:enron-tar] No tarball on disk. Set EVAL_ENRON_TAR, or add sourceUrl to enron-kean-manifest.json, or ENRON_SOURCE_URL.',
    )
    process.exit(1)
  }

  console.error('[eval:enron-tar] Target:', cached)
  const part = `${cached}.part`

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

  renameSync(part, cached)
  console.error('[eval:enron-tar] Verified and saved:', cached)
  return cached
}
