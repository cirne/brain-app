import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface BundleDefaults {
  version: number
  default_brain_home: { darwin: string; other: string }
  tauri_logs_dir_darwin?: string
}

let cached: BundleDefaults | null = null

export function resolveBundleDefaultsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '../../../shared/bundle-defaults.json'),
    join(here, '../../shared/bundle-defaults.json'),
    join(process.cwd(), 'shared/bundle-defaults.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `bundle-defaults.json not found (tried ${candidates.slice(0, 2).join(', ')} and cwd/shared)`,
  )
}

export function getBundleDefaults(): BundleDefaults {
  if (cached) return cached
  const path = resolveBundleDefaultsPath()
  cached = JSON.parse(readFileSync(path, 'utf-8')) as BundleDefaults
  return cached
}

/** Default `BRAIN_HOME` for the packaged native app (matches Tauri spawn + clean scripts). */
export function defaultBundledBrainHomeRoot(): string {
  const b = getBundleDefaults()
  const rel =
    process.platform === 'darwin' ? b.default_brain_home.darwin : b.default_brain_home.other
  return join(homedir(), rel)
}
