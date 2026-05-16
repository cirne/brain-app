/**
 * Stable Enron corpus tarball cache at `<repoRoot>/.cache/enron/` (gitignored).
 * Survives `pnpm run dev:clean` (./data) and data-eval wipes.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { sha256File } from './evalBrainCommon.mjs'

export const ENRON_MAIL_TARBALL_BASENAME = 'enron_mail_20150507.tar.gz'

/** @param {string} repoRoot */
export function enronTarballPrimaryDir(repoRoot) {
  return join(repoRoot, '.cache', 'enron')
}

/** @param {string} repoRoot */
export function enronTarballPrimaryPath(repoRoot) {
  return join(enronTarballPrimaryDir(repoRoot), ENRON_MAIL_TARBALL_BASENAME)
}

/** Legacy caches (migrated into primary on first use). @param {string} repoRoot */
export function enronTarballLegacyPaths(repoRoot) {
  const base = ENRON_MAIL_TARBALL_BASENAME
  return [
    join(repoRoot, 'data-eval', '.cache', 'enron', base),
    join(repoRoot, 'data', '.cache', 'enron', base),
  ]
}

/**
 * @param {string} repoRoot
 * @param {string} expectedSha
 * @returns {string | null} primary path when present or migrated
 */
export function resolveOrMigrateEnronTarball(repoRoot, expectedSha) {
  const primary = enronTarballPrimaryPath(repoRoot)
  if (existsSync(primary)) {
    const got = sha256File(primary)
    if (got === expectedSha) {
      return primary
    }
    console.error('[eval:enron-tar] Tarball SHA mismatch at', primary)
  }

  for (const legacy of enronTarballLegacyPaths(repoRoot)) {
    if (!existsSync(legacy)) continue
    const got = sha256File(legacy)
    if (got !== expectedSha) {
      console.error('[eval:enron-tar] Tarball SHA mismatch at', legacy)
      continue
    }
    mkdirSync(enronTarballPrimaryDir(repoRoot), { recursive: true })
    if (existsSync(primary)) {
      try {
        rmSync(primary)
      } catch {
        /* */
      }
    }
    renameSync(legacy, primary)
    console.error('[eval:enron-tar] Moved tarball to', primary)
    return primary
  }

  return null
}
