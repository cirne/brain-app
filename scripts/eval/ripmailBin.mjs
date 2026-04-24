/**
 * Prefer repo-built ripmail that actually runs (`--version` works), then PATH.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/** Repo root (brain-app). */
export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function versionWorks(bin) {
  if (!bin) return false
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  return !r.error && r.status === 0
}

/** @param {string} [root] */
export function resolveRipmailBin(root = repoRoot) {
  const candidates = [join(root, 'target/release/ripmail'), join(root, 'target/debug/ripmail'), 'ripmail']
  for (const c of candidates) {
    if (c === 'ripmail' || existsSync(c)) {
      if (versionWorks(c)) return c
    }
  }
  return join(root, 'target/debug/ripmail')
}

/** @param {string} bin */
export function ripmailVersionLine(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    return `unknown (exit ${r.status})`
  }
  return (r.stdout || '').split('\n')[0].trim() || 'unknown'
}
