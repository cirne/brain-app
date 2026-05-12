import Database from 'better-sqlite3'
import { mkdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutTenantSqlitePath } from '@server/lib/platform/brainLayout.js'

/**
 * Bump when `brain-tenant.sqlite` layout changes. Older files are deleted and recreated (no ALTER migrations).
 */
export const TENANT_SCHEMA_VERSION = 2

/**
 * Per-tenant Brain app SQLite (chat, notifications). Ripmail keeps its own DB under `ripmail/` until OPP-108 merges schemas.
 * Override path in tests via `BRAIN_TENANT_SQLITE_PATH` (single file; implies one tenant home per test process or close cache).
 */
export function tenantSqlitePathForHome(home: string): string {
  const override = process.env.BRAIN_TENANT_SQLITE_PATH?.trim()
  if (override) return resolve(override)
  return resolve(brainLayoutTenantSqlitePath(home))
}

export function readTenantSchemaVersion(db: Database.Database): number | null {
  try {
    const row = db.prepare(`SELECT version FROM brain_tenant_schema WHERE id = 1`).get() as
      | { version: number }
      | undefined
    return row != null && typeof row.version === 'number' ? row.version : null
  } catch {
    return null
  }
}

/** Apply full DDL + version row (fresh file). */
export function initTenantSchema(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
CREATE TABLE brain_tenant_schema (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);
`)
    db.prepare(`INSERT INTO brain_tenant_schema (id, version) VALUES (1, ?)`).run(TENANT_SCHEMA_VERSION)
    db.exec(`
CREATE TABLE chat_sessions (
  session_id TEXT PRIMARY KEY,
  title TEXT,
  preview TEXT,
  session_type TEXT NOT NULL DEFAULT 'own' CHECK (session_type IN ('own', 'b2b_outbound', 'b2b_inbound')),
  remote_grant_id TEXT,
  remote_handle TEXT,
  remote_display_name TEXT,
  approval_state TEXT CHECK (approval_state IS NULL OR approval_state IN ('pending', 'approved', 'declined', 'auto')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (session_type = 'own' OR remote_grant_id IS NOT NULL)
);
CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at_ms DESC);
CREATE UNIQUE INDEX idx_b2b_session_unique
  ON chat_sessions(session_type, remote_grant_id)
  WHERE session_type != 'own';

CREATE TABLE chat_messages (
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unread',
  idempotency_key TEXT UNIQUE,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_notifications_state_created ON notifications(state, created_at_ms DESC);
`)
  })()
}

const dbCache = new Map<string, Database.Database>()

/** Close and drop cached handle for a tenant home (e.g. before `wipeBrainHomeContents` removes `var/`). */
export function evictTenantDbForHome(home: string): void {
  const path = tenantSqlitePathForHome(home)
  const db = dbCache.get(path)
  if (db) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    dbCache.delete(path)
  }
}

function openTenantDbAtPath(resolvedPath: string): Database.Database {
  mkdirSync(dirname(resolvedPath), { recursive: true })
  let db = new Database(resolvedPath)
  db.pragma('foreign_keys = ON')
  const ver = readTenantSchemaVersion(db)
  if (ver !== TENANT_SCHEMA_VERSION) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(resolvedPath)
    } catch {
      /* ENOENT ok */
    }
    db = new Database(resolvedPath)
    db.pragma('foreign_keys = ON')
    initTenantSchema(db)
  }
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * Lazily opens the tenant DB for {@link brainHome}, rebuilding the file when schema version differs.
 * Cached per resolved path (multi-tenant safe).
 */
export function getTenantDb(): Database.Database {
  const path = tenantSqlitePathForHome(brainHome())
  let db = dbCache.get(path)
  if (db) return db
  db = openTenantDbAtPath(path)
  dbCache.set(path, db)
  return db
}

/** Test helper: close all cached handles so the next open uses a new file/env. */
export function closeTenantDbForTests(): void {
  for (const db of dbCache.values()) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
  dbCache.clear()
}
