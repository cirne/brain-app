import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/**
 * Bundled Braintunnel.app defaults — must match `desktop/src/brain_paths.rs` + `shared/brain-layout.json`
 * + `shared/bundle-defaults.json`.
 */
function macBundledDefaultPaths(home: string) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  const layout = JSON.parse(readFileSync(join(root, 'shared/brain-layout.json'), 'utf-8')) as {
    directories: { wiki: string; ripmail: string }
  }
  const bundle = JSON.parse(readFileSync(join(root, 'shared/bundle-defaults.json'), 'utf-8')) as {
    default_brain_home: { darwin: string }
    default_wiki_parent_darwin?: string
  }
  const brainHome = join(home, bundle.default_brain_home.darwin)
  const wikiRel = bundle.default_wiki_parent_darwin ?? 'Documents/Brain'
  const wikiParent = join(home, wikiRel)
  return {
    brainHome,
    ripmailHome: join(brainHome, layout.directories.ripmail),
    wikiContentDir: join(wikiParent, layout.directories.wiki),
  }
}

describe('mac bundled default paths (BRAIN_HOME)', () => {
  it('matches Tauri brain_paths.rs macOS layout + shared/brain-layout.json', () => {
    const p = macBundledDefaultPaths('/Users/x')
    expect(p.brainHome).toBe('/Users/x/Library/Application Support/Brain')
    expect(p.ripmailHome).toBe('/Users/x/Library/Application Support/Brain/ripmail')
    expect(p.wikiContentDir).toBe('/Users/x/Documents/Brain/wiki')
  })
})
