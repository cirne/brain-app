import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { realpathSync } from 'node:fs'
import {
  PathEscapeError,
  isAbsolutePathAllowedUnderRoots,
  resolvePathStrictlyUnderHome,
} from './resolveTenantSafePath.js'

describe('resolveTenantSafePath', () => {
  let base: string

  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true })
  })

  it('resolvePathStrictlyUnderHome rejects .. escape', () => {
    base = join(tmpdir(), `safe-${Date.now()}`)
    mkdirSync(join(base, 'inside'), { recursive: true })
    expect(() => resolvePathStrictlyUnderHome(base, '..', 'outside')).toThrow(PathEscapeError)
  })

  it('resolvePathStrictlyUnderHome allows nested path under home', () => {
    base = join(tmpdir(), `safe-${Date.now()}`)
    mkdirSync(join(base, 'wiki'), { recursive: true })
    const p = resolvePathStrictlyUnderHome(base, 'wiki', 'a.md')
    expect(p.startsWith(realpathSync(base))).toBe(true)
  })

  it('isAbsolutePathAllowedUnderRoots rejects paths outside tenant', () => {
    base = join(tmpdir(), `safe-${Date.now()}`)
    mkdirSync(base, { recursive: true })
    expect(isAbsolutePathAllowedUnderRoots(join(tmpdir(), 'other'), base, [])).toBe(false)
  })

  it('normalizePathThroughExistingAncestors preserves suffix under deepest existing ancestor', async () => {
    const { normalizePathThroughExistingAncestors } = await import('@server/lib/tenant/resolveTenantSafePath.js')
    const base = mkdtempSync(join(tmpdir(), 'np-'))
    mkdirSync(join(base, 'a', 'b'), { recursive: true })
    const leaf = join(base, 'a', 'b', 'missing.md')
    const n = normalizePathThroughExistingAncestors(leaf)
    expect(n.endsWith(join('a', 'b', 'missing.md')) || n.endsWith('missing.md')).toBe(true)
    rmSync(base, { recursive: true, force: true })
  })

  it('isAbsolutePathAllowedUnderRoots follows symlink only when target stays inside', () => {
    base = join(tmpdir(), `safe-${Date.now()}`)
    const inner = join(base, 'ripmail')
    const outside = join(tmpdir(), `outside-${Date.now()}`)
    mkdirSync(inner, { recursive: true })
    mkdirSync(outside, { recursive: true })
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'x', 'utf-8')
    const link = join(inner, 'escape')
    symlinkSync(outside, link, 'dir')
    expect(isAbsolutePathAllowedUnderRoots(join(link, 'secret.txt'), base, [inner])).toBe(false)
  })
})
