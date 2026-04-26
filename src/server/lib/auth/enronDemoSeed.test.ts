import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isEnronDemoTenantReady, resetEnronDemoSeedStateForTests } from './enronDemoSeed.js'

describe('enronDemoSeed', () => {
  afterEach(() => {
    resetEnronDemoSeedStateForTests()
  })

  it('isEnronDemoTenantReady requires non-empty ripmail.db', async () => {
    const root = await mkdtemp(join(tmpdir(), 'enron-ready-'))
    try {
      const home = join(root, 't1')
      await mkdir(join(home, 'ripmail'), { recursive: true })
      expect(isEnronDemoTenantReady(home)).toBe(false)
      await writeFile(join(home, 'ripmail', 'ripmail.db'), 'x', 'utf8')
      expect(isEnronDemoTenantReady(home)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
