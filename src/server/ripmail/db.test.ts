import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as rebuildFromMaildir from './rebuildFromMaildir.js'
import {
  closeRipmailDb,
  prepareRipmailDb,
  RipmailDbSchemaDriftError,
  openRipmailDb,
  ripmailDbPath,
} from './db.js'
import { SCHEMA_VERSION } from './schema.js'

describe('prepareRipmailDb / drift', () => {
  let ripHome: string

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

  it('concurrent prepareRipmailDb shares one rebuild (single-flight)', async () => {
    const home = freshRipmailHome()
    writeStaleVersionDb(home, SCHEMA_VERSION - 1)

    const spy = vi.spyOn(rebuildFromMaildir, 'repopulateRipmailIndexFromAllMaildirs').mockResolvedValue(0)
    try {
      await Promise.all([prepareRipmailDb(home), prepareRipmailDb(home)])
      expect(spy).toHaveBeenCalledTimes(1)
      const ready = openRipmailDb(home)
      expect(ready.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    } finally {
      spy.mockRestore()
    }
  })
})
