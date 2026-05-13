import Database from 'better-sqlite3'
import { mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { globalDir } from '@server/lib/tenant/dataRoot.js'

/**
 * Bump when `brain-global.sqlite` layout changes. Older files are deleted and recreated (no ALTER migrations).
 */
export const BRAIN_GLOBAL_SCHEMA_VERSION = 6

/**
 * Cross-tenant metadata (brain-query delegation grants; tenant-registry migration later).
 * Override path in tests via `BRAIN_GLOBAL_SQLITE_PATH`.
 */
export function brainGlobalSqlitePath(): string {
  const override = process.env.BRAIN_GLOBAL_SQLITE_PATH?.trim()
  if (override) return override
  return join(globalDir(), 'brain-global.sqlite')
}

export function readBrainGlobalSchemaVersion(db: Database.Database): number | null {
  try {
    const row = db.prepare(`SELECT version FROM brain_global_schema WHERE id = 1`).get() as
      | { version: number }
      | undefined
    return row != null && typeof row.version === 'number' ? row.version : null
  } catch {
    return null
  }
}

/** Full schema for a fresh global DB (version row + brain-query delegation grants). */
export function initBrainGlobalSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
CREATE TABLE brain_global_schema (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
`)
    db.prepare(`INSERT INTO brain_global_schema (id, version) VALUES (1, ?)`).run(BRAIN_GLOBAL_SCHEMA_VERSION)
    db.exec(`
CREATE TABLE brain_query_grants (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  asker_id        TEXT NOT NULL,
  privacy_policy  TEXT NOT NULL,
  auto_send       INTEGER NOT NULL DEFAULT 0 CHECK (auto_send IN (0, 1)),
  created_at_ms   INTEGER NOT NULL,
  updated_at_ms   INTEGER NOT NULL,
  revoked_at_ms   INTEGER,
  UNIQUE(owner_id, asker_id)
);
CREATE INDEX idx_brain_query_grants_owner ON brain_query_grants(owner_id);
CREATE INDEX idx_brain_query_grants_asker ON brain_query_grants(asker_id);
`)
  })()
}

let cached: Database.Database | null = null
let cachedPath: string | null = null

/** Lazily opens the global DB (WAL), rebuilding the file when schema version differs. */
export function getBrainGlobalDb(): Database.Database {
  const path = brainGlobalSqlitePath()
  if (cached && cachedPath === path) return cached
  if (cached) {
    try {
      cached.close()
    } catch {
      /* ignore */
    }
    cached = null
    cachedPath = null
  }
  mkdirSync(dirname(path), { recursive: true })
  let db = new Database(path)
  const ver = readBrainGlobalSchemaVersion(db)
  if (ver !== BRAIN_GLOBAL_SCHEMA_VERSION) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(path)
    } catch {
      /* ENOENT ok */
    }
    db = new Database(path)
    initBrainGlobalSchema(db)
  }
  db.pragma('journal_mode = WAL')
  cached = db
  cachedPath = path
  return db
}

/** Test helper: close singleton so the next open uses a new path/env. */
export function closeBrainGlobalDbForTests(): void {
  if (cached) {
    try {
      cached.close()
    } catch {
      /* ignore */
    }
  }
  cached = null
  cachedPath = null
}
