import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  indexedFolderRootsFromSourcesListJson,
  ripmailReadIdLooksLikeFilesystemPath,
} from './agentPathPolicy.js'

describe('agentPathPolicy', () => {
  it('ripmailReadIdLooksLikeFilesystemPath detects paths', () => {
    expect(ripmailReadIdLooksLikeFilesystemPath('/etc/passwd')).toBe(true)
    expect(ripmailReadIdLooksLikeFilesystemPath('~/x')).toBe(true)
    expect(ripmailReadIdLooksLikeFilesystemPath('C:\\foo')).toBe(true)
    expect(ripmailReadIdLooksLikeFilesystemPath('\\\\server\\share')).toBe(true)
    expect(ripmailReadIdLooksLikeFilesystemPath('<x@y>')).toBe(false)
    expect(ripmailReadIdLooksLikeFilesystemPath('CAFEBABE@mail.gmail.com')).toBe(false)
  })

  it('indexedFolderRootsFromSourcesListJson collects localDir and icsFile paths', () => {
    const roots = indexedFolderRootsFromSourcesListJson({
      sources: [
        { id: 'a', kind: 'imap', path: '/should/not' },
        { id: 'b', kind: 'localDir', path: '/tmp/myfiles' },
        { id: 'c', kind: 'icsFile', path: '~/cal.ics' },
      ],
    })
    expect(roots.some((r) => r.endsWith('myfiles'))).toBe(true)
    expect(roots.some((r) => r.includes('cal.ics'))).toBe(true)
    expect(roots.some((r) => r.includes('should'))).toBe(false)
  })
})

describe('assertManageSourcePathNotInsideSiblingTenant', () => {
  let prevDataRoot: string | undefined
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'mt-src-'))
    prevDataRoot = process.env.BRAIN_DATA_ROOT
    process.env.BRAIN_DATA_ROOT = base
  })

  afterEach(() => {
    process.env.BRAIN_DATA_ROOT = prevDataRoot
    rmSync(base, { recursive: true, force: true })
    delete process.env.BRAIN_HOME
    vi.restoreAllMocks()
  })

  it('throws when path is inside another tenant directory', async () => {
    const tenantA = join(base, 'alice')
    const tenantB = join(base, 'bob')
    mkdirSync(join(tenantA, 'wiki'), { recursive: true })
    mkdirSync(join(tenantB, 'wiki'), { recursive: true })

    const { runWithTenantContext } = await import('./tenantContext.js')
    const { assertManageSourcePathNotInsideSiblingTenant } = await import('./agentPathPolicy.js')

    runWithTenantContext({ workspaceHandle: 'alice', homeDir: tenantA }, () => {
      process.env.BRAIN_HOME = tenantA
      expect(() =>
        assertManageSourcePathNotInsideSiblingTenant(join(tenantB, 'wiki', 'x.md')),
      ).toThrow(/another tenant/)
    })
  })
})
