import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  anyTenantVaultVerifierExistsSync,
  dataRoot,
  ensureTenantHomeDir,
  globalDir,
  isMultiTenantMode,
  tenantHomeDir,
} from './dataRoot.js'
import { brainLayoutWikiDir, brainLayoutVaultVerifierPath } from '@server/lib/platform/brainLayout.js'

describe('dataRoot', () => {
  const prev = process.env.BRAIN_DATA_ROOT

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.BRAIN_DATA_ROOT
    } else {
      process.env.BRAIN_DATA_ROOT = prev
    }
  })

  it('isMultiTenantMode false when BRAIN_DATA_ROOT unset', () => {
    delete process.env.BRAIN_DATA_ROOT
    expect(isMultiTenantMode()).toBe(false)
  })

  it('isMultiTenantMode true when set', () => {
    process.env.BRAIN_DATA_ROOT = '/data'
    expect(isMultiTenantMode()).toBe(true)
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

  it('anyTenantVaultVerifierExistsSync detects verifier in a tenant dir', () => {
    const base = join(tmpdir(), `brain-any-vault-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = base
    mkdirSync(base, { recursive: true })
    const tid = 'u1'
    const home = ensureTenantHomeDir(tid)
    writeFileSync(brainLayoutVaultVerifierPath(home), '{"v":1}', 'utf-8')
    expect(anyTenantVaultVerifierExistsSync()).toBe(true)
    rmSync(base, { recursive: true, force: true })
  })
})
