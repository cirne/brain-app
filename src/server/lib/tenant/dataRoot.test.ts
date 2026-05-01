import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataRoot, ensureTenantHomeDir, globalDir, tenantHomeDir } from './dataRoot.js'
import { brainLayoutWikiDir } from '@server/lib/platform/brainLayout.js'

describe('dataRoot', () => {
  const prev = process.env.BRAIN_DATA_ROOT

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.BRAIN_DATA_ROOT
    } else {
      process.env.BRAIN_DATA_ROOT = prev
    }
  })

  it('dataRoot throws when BRAIN_DATA_ROOT unset', () => {
    delete process.env.BRAIN_DATA_ROOT
    expect(() => dataRoot()).toThrow('BRAIN_DATA_ROOT is not set')
  })

  it('tenantHomeDir and globalDir resolve under data root', () => {
    process.env.BRAIN_DATA_ROOT = join(tmpdir(), 'brain-mt-test-root')
    const root = process.env.BRAIN_DATA_ROOT
    expect(tenantHomeDir('abc')).toBe(join(root, 'abc'))
    expect(globalDir()).toBe(join(root, '.global'))
    expect(dataRoot()).toBe(root)
  })

  it('ensureTenantHomeDir creates layout directories', () => {
    const base = join(tmpdir(), `brain-layout-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = base
    mkdirSync(base, { recursive: true })
    const tid = 'tenant-uuid-1'
    const home = ensureTenantHomeDir(tid)
    expect(home).toBe(join(base, tid))
    expect(brainLayoutWikiDir(home)).toBe(join(home, 'wiki'))
    expect(existsSync(join(home, 'wiki'))).toBe(true)
    expect(existsSync(join(home, 'ripmail'))).toBe(true)
    expect(existsSync(join(home, 'var'))).toBe(true)
    rmSync(base, { recursive: true, force: true })
  })
})
