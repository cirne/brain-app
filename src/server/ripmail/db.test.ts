import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  const SAMPLE_PREPARE_EML = `Message-ID: <prepare-integration@test.dev>
Date: Mon, 15 Jan 2026 12:00:00 +0000
From: Prep <prep@test.dev>
To: Other <other@test.dev>
Subject: prepareRipmailDb integration

Body text.
`

  it('prepareRipmailDb wipes stale user_version and repopulates from legacy maildir (no mock)', async () => {
    const home = freshRipmailHome()
    const cur = join(home, 'maildir', 'cur')
    mkdirSync(cur, { recursive: true })
    writeFileSync(join(cur, 'seed.eml'), SAMPLE_PREPARE_EML)
    writeStaleVersionDb(home, SCHEMA_VERSION - 1)

    await prepareRipmailDb(home)

    const db = openRipmailDb(home)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM messages`)
        .get() as { c: number }
      expect(row.c).toBe(1)
    } finally {
      db.close()
    }
  })
})
