import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { HANDLE_META_FILENAME } from '@server/lib/tenant/handleMeta.js'

vi.mock('./runRipmailRepopulateChild.js', () => ({
  runRipmailRepopulateChild: vi.fn(async () => undefined),
}))

import { runRipmailRepopulateChild } from './runRipmailRepopulateChild.js'
import {
  closeRipmailDb,
  prepareRipmailDb,
  RipmailDbSchemaDriftError,
  openRipmailDb,
  ripmailDbPath,
  RIPMAIL_DB_USER_VERSION_PENDING,
} from './db.js'
import { SCHEMA_VERSION } from './schema.js'

describe('prepareRipmailDb / drift', () => {
  let ripHome: string

  beforeEach(() => {
    vi.mocked(runRipmailRepopulateChild).mockClear()
  })

  afterEach(() => {
    closeRipmailDb(ripHome)
    try {
      rmSync(ripHome, { recursive: true })
    } catch {
      /* */
    }
  })

  function freshRipmailHome(): string {
    ripHome = join(mkdtempSync(join(tmpdir(), 'ripmail-db-test-')), 'ripmail')
    return ripHome
  }

  /** On-disk SQLite with deliberate wrong `user_version`. */
  function writeStaleVersionDb(home: string, storedVersion: number): void {
    mkdirSync(home, { recursive: true })
    const p = ripmailDbPath(home)
    const db = new Database(p)
    db.prepare('CREATE TABLE IF NOT EXISTS t(x INTEGER)').run()
    db.pragma(`user_version = ${storedVersion}`)
    db.close()
  }

  it('openRipmailDb throws RipmailDbSchemaDriftError when user_version mismatches SCHEMA_VERSION', () => {
    const home = freshRipmailHome()
    writeStaleVersionDb(home, SCHEMA_VERSION - 1)

    expect(() => openRipmailDb(home)).toThrow(RipmailDbSchemaDriftError)
  })

  it('openRipmailDb throws RipmailDbSchemaDriftError for pending rebuild user_version', () => {
    const home = freshRipmailHome()
    writeStaleVersionDb(home, RIPMAIL_DB_USER_VERSION_PENDING)

    expect(() => openRipmailDb(home)).toThrow(RipmailDbSchemaDriftError)
  })

  it('concurrent prepareRipmailDb shares one rebuild (single-flight)', async () => {
    const home = freshRipmailHome()
    writeStaleVersionDb(home, SCHEMA_VERSION - 1)

    await Promise.all([prepareRipmailDb(home), prepareRipmailDb(home)])
    expect(runRipmailRepopulateChild).toHaveBeenCalledTimes(1)
    expect(runRipmailRepopulateChild).toHaveBeenCalledWith(
      home,
      expect.objectContaining({ ripmailHome: home }),
    )
    const ready = openRipmailDb(home)
    expect(ready.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('logs tenantUserId and workspaceHandle on rebuild when tenant ALS matches ripmail home', async () => {
    const tenantHome = mkdtempSync(join(tmpdir(), 'ripmail-db-log-'))
    ripHome = join(tenantHome, 'ripmail')
    writeStaleVersionDb(ripHome, SCHEMA_VERSION - 1)

    const warnSpy = vi.spyOn(brainLogger, 'warn')
    const infoSpy = vi.spyOn(brainLogger, 'info')
    try {
      await runWithTenantContextAsync(
        {
          tenantUserId: 'usr_test1234567890123456',
          workspaceHandle: 'acme-dev',
          homeDir: tenantHome,
        },
        async () => prepareRipmailDb(ripHome),
      )

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantUserId: 'usr_test1234567890123456',
          workspaceHandle: 'acme-dev',
          ripmailHome: ripHome,
          stored: SCHEMA_VERSION - 1,
          expected: SCHEMA_VERSION,
        }),
        expect.stringContaining('version-mismatch'),
      )
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantUserId: 'usr_test1234567890123456',
          workspaceHandle: 'acme-dev',
          ripmailHome: ripHome,
          schemaVersion: SCHEMA_VERSION,
        }),
        expect.stringContaining('rebuild-complete'),
      )
    } finally {
      warnSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  it('logs tenantUserId and workspaceHandle from handle-meta when ALS is absent', async () => {
    const tenantHome = mkdtempSync(join(tmpdir(), 'ripmail-db-meta-'))
    ripHome = join(tenantHome, 'ripmail')
    writeStaleVersionDb(ripHome, SCHEMA_VERSION - 1)
    writeFileSync(
      join(tenantHome, HANDLE_META_FILENAME),
      JSON.stringify({
        userId: 'usr_meta1234567890123456',
        handle: 'from-meta',
      }),
    )

    const warnSpy = vi.spyOn(brainLogger, 'warn')
    const infoSpy = vi.spyOn(brainLogger, 'info')
    try {
      await prepareRipmailDb(ripHome)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantUserId: 'usr_meta1234567890123456',
          workspaceHandle: 'from-meta',
        }),
        expect.any(String),
      )
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantUserId: 'usr_meta1234567890123456',
          workspaceHandle: 'from-meta',
        }),
        expect.stringContaining('rebuild-complete'),
      )
    } finally {
      warnSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  it('prepareRipmailDb treats pending user_version as drift and returns a ready db after child rebuild', async () => {
    const home = freshRipmailHome()
    writeStaleVersionDb(home, RIPMAIL_DB_USER_VERSION_PENDING)

    await prepareRipmailDb(home)

    const db = openRipmailDb(home)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      expect(runRipmailRepopulateChild).toHaveBeenCalledWith(
        home,
        expect.objectContaining({ ripmailHome: home, stored: RIPMAIL_DB_USER_VERSION_PENDING }),
      )
    } finally {
      db.close()
    }
  })
})
