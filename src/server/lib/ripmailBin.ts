import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Path to the ripmail CLI for subprocess calls.
 * Bundled Brain.app sets `RIPMAIL_BIN` to an absolute path; this also falls back to
 * `./ripmail` next to cwd when `BRAIN_BUNDLED_NATIVE=1` (server-bundle layout).
 */
export function ripmailBin(): string {
  const fromEnv = process.env.RIPMAIL_BIN?.trim()
  if (fromEnv) return fromEnv
  if (process.env.BRAIN_BUNDLED_NATIVE === '1') {
    const bundled = join(process.cwd(), 'ripmail')
    if (existsSync(bundled)) return bundled
  }
  return 'ripmail'
}
