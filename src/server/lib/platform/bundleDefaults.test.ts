import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultBundledBrainHomeRoot,
  defaultBundledWikiParentRoot,
  getBundleDefaults,
  resolveBundleDefaultsPath,
} from './bundleDefaults.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

describe('bundleDefaults', () => {
  it('loads shared/bundle-defaults.json and matches repo file', () => {
    const fromDisk = JSON.parse(readFileSync(join(root, 'shared/bundle-defaults.json'), 'utf-8'))
    expect(getBundleDefaults().version).toBe(fromDisk.version)
    expect(getBundleDefaults().default_brain_home).toEqual(fromDisk.default_brain_home)
    expect(resolveBundleDefaultsPath()).toBe(join(root, 'shared/bundle-defaults.json'))
  })

  it('defaultBundledBrainHomeRoot joins homedir with OS segment from JSON', () => {
    const rel =
      process.platform === 'darwin'
        ? getBundleDefaults().default_brain_home.darwin
        : getBundleDefaults().default_brain_home.other
    expect(defaultBundledBrainHomeRoot()).toBe(join(homedir(), rel))
  })

  it('defaultBundledWikiParentRoot uses default_wiki_parent_darwin on macOS', () => {
    const rel = getBundleDefaults().default_wiki_parent_darwin ?? 'Documents/Brain'
    expect(defaultBundledWikiParentRoot()).toBe(join(homedir(), rel))
  })
})
