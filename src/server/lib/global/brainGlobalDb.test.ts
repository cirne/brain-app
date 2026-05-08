import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  BRAIN_GLOBAL_SCHEMA_VERSION,
  closeBrainGlobalDbForTests,
  getBrainGlobalDb,
  readBrainGlobalSchemaVersion,
} from './brainGlobalDb.js'

describe('brainGlobalDb', () => {
  const prev = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(() => {
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    if (prev !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prev
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
  })

  it('rebuilds the file when stored schema version is older than code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brain-global-ver-'))
    const path = join(dir, 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = path

    const stale = new Database(path)
    stale.exec(`
CREATE TABLE brain_global_schema (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
INSERT INTO brain_global_schema (id, version) VALUES (1, 1);
CREATE TABLE wiki_stale (x TEXT);
`)
    stale.close()

    const db = getBrainGlobalDb()
    const ver = readBrainGlobalSchemaVersion(db)
    expect(ver).toBe(BRAIN_GLOBAL_SCHEMA_VERSION)
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as {
      name: string
    }[]
    expect(tables.some((t) => t.name === 'wiki_shares')).toBe(false)
    expect(tables.some((t) => t.name === 'brain_query_grants')).toBe(true)
    expect(tables.some((t) => t.name === 'brain_query_log')).toBe(true)
    expect(tables.some((t) => t.name === 'wiki_stale')).toBe(false)

    await rm(dir, { recursive: true, force: true })
  })
})
