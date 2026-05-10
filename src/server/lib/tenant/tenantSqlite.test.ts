import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  TENANT_SCHEMA_VERSION,
  closeTenantDbForTests,
  getTenantDb,
  readTenantSchemaVersion,
} from './tenantSqlite.js'

describe('tenantSqlite', () => {
  const prevHome = process.env.BRAIN_HOME
  const prevTenantSqlite = process.env.BRAIN_TENANT_SQLITE_PATH

  beforeEach(() => {
    closeTenantDbForTests()
  })

  afterEach(async () => {
    closeTenantDbForTests()
    if (prevHome !== undefined) process.env.BRAIN_HOME = prevHome
    else delete process.env.BRAIN_HOME
    if (prevTenantSqlite !== undefined) process.env.BRAIN_TENANT_SQLITE_PATH = prevTenantSqlite
    else delete process.env.BRAIN_TENANT_SQLITE_PATH
  })

  it('rebuilds the file when stored schema version differs from code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tenant-sqlite-ver-'))
    process.env.BRAIN_HOME = dir
    const path = join(dir, 'var', 'brain-tenant.sqlite')
    mkdirSync(dirname(path), { recursive: true })
    process.env.BRAIN_TENANT_SQLITE_PATH = path

    const stale = new Database(path)
    stale.exec(`
CREATE TABLE brain_tenant_schema (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
INSERT INTO brain_tenant_schema (id, version) VALUES (1, 0);
CREATE TABLE junk_stale (x TEXT);
`)
    stale.close()

    const db = getTenantDb()
    const ver = readTenantSchemaVersion(db)
    expect(ver).toBe(TENANT_SCHEMA_VERSION)
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as {
      name: string
    }[]
    expect(tables.some(t => t.name === 'junk_stale')).toBe(false)
    expect(tables.some(t => t.name === 'chat_sessions')).toBe(true)
    expect(tables.some(t => t.name === 'notifications')).toBe(true)

    await rm(dir, { recursive: true, force: true })
  })
})
