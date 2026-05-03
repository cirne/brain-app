import Database from 'better-sqlite3'
import { mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { globalDir } from '@server/lib/tenant/dataRoot.js'

/**
 * Bump when `brain-global.sqlite` layout changes. Older files are deleted and recreated (no ALTER migrations).
 */
export const BRAIN_GLOBAL_SCHEMA_VERSION = 2

/**
 * Cross-tenant metadata (wiki shares ACL; tenant-registry migration later).
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

/** Full schema for a fresh global DB (version row + wiki_shares). */
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
CREATE TABLE wiki_shares (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL,
  grantee_id       TEXT NOT NULL,
  grantee_email    TEXT,
  path_prefix      TEXT NOT NULL,
  target_kind      TEXT NOT NULL DEFAULT 'dir',
  invite_token     TEXT NOT NULL UNIQUE,
  created_at_ms    INTEGER NOT NULL,
  accepted_at_ms   INTEGER,
  revoked_at_ms    INTEGER
);
CREATE INDEX idx_wiki_shares_owner ON wiki_shares(owner_id);
CREATE INDEX idx_wiki_shares_grantee ON wiki_shares(grantee_id);
CREATE INDEX idx_wiki_shares_token ON wiki_shares(invite_token);
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
