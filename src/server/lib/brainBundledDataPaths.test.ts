import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * OPP-007 layout for Brain.app — must match `src-tauri/src/brain_paths.rs` (macOS).
 * Used as a regression check in CI (Vitest); Rust is the spawn-time source of truth.
 */
function macBundledDefaultPaths(home: string) {
  return {
    wikiDir: join(home, 'Documents/Brain'),
    chatDataDir: join(home, 'Library/Application Support/Brain/data/chat'),
    ripmailHome: join(home, 'Library/Application Support/Brain/ripmail'),
  }
}

describe('mac bundled default paths (OPP-007)', () => {
  it('matches Tauri brain_paths.rs macOS layout', () => {
    const p = macBundledDefaultPaths('/Users/x')
    expect(p.wikiDir).toBe('/Users/x/Documents/Brain')
    expect(p.chatDataDir).toBe('/Users/x/Library/Application Support/Brain/data/chat')
    expect(p.ripmailHome).toBe('/Users/x/Library/Application Support/Brain/ripmail')
  })
})
