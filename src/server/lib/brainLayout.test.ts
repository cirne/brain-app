import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBrainLayout, resolveBrainLayoutPath } from './brainLayout.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('brainLayout', () => {
  it('loads shared/brain-layout.json and matches repo file', () => {
    const fromDisk = JSON.parse(readFileSync(join(root, 'shared/brain-layout.json'), 'utf-8'))
    expect(getBrainLayout().version).toBe(fromDisk.version)
    expect(getBrainLayout().directories).toEqual(fromDisk.directories)
    expect(resolveBrainLayoutPath()).toBe(join(root, 'shared/brain-layout.json'))
  })
})
