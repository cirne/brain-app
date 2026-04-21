import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRepoSharedPath, tryResolveRepoSharedPath } from './resolveRepoSharedPath.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('resolveRepoSharedPath', () => {
  it('resolves brain-layout.json to repo shared/ when run from source', () => {
    const p = resolveRepoSharedPath('brain-layout.json')
    expect(p).toBe(join(root, 'shared/brain-layout.json'))
    expect(JSON.parse(readFileSync(p, 'utf-8')).version).toBeTypeOf('number')
  })

  it('tryResolve returns null for missing file', () => {
    expect(tryResolveRepoSharedPath('definitely-missing-xyz.json')).toBeNull()
  })
})
