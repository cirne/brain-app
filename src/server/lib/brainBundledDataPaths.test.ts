import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/**
 * Bundled Brain.app defaults — must match `desktop/src/brain_paths.rs` + `shared/brain-layout.json`.
 */
function macBundledDefaultPaths(home: string) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const layout = JSON.parse(readFileSync(join(root, 'shared/brain-layout.json'), 'utf-8')) as {
    directories: { ripmail: string }
  }
  const brainHome = join(home, 'Library/Application Support/Brain')
  return {
    brainHome,
    ripmailHome: join(brainHome, layout.directories.ripmail),
  }
}

describe('mac bundled default paths (BRAIN_HOME)', () => {
  it('matches Tauri brain_paths.rs macOS layout + shared/brain-layout.json', () => {
    const p = macBundledDefaultPaths('/Users/x')
    expect(p.brainHome).toBe('/Users/x/Library/Application Support/Brain')
    expect(p.ripmailHome).toBe('/Users/x/Library/Application Support/Brain/ripmail')
  })
})
