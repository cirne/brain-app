import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { globalDir } from '@server/lib/tenant/dataRoot.js'

/**
 * Cross-tenant metadata (OPP-064 wiki shares first; tenant-registry migration later).
 * Override path in tests via `BRAIN_GLOBAL_SQLITE_PATH`.
 */
export function brainGlobalSqlitePath(): string {
  const override = process.env.BRAIN_GLOBAL_SQLITE_PATH?.trim()
  if (override) return override
  return join(globalDir(), 'brain-global.sqlite')
}

let cached: Database.Database | null = null
let cachedPath: string | null = null

export function ensureBrainGlobalSchema(db: Database.Database): void {
  /* Legacy DB without target_kind: drop and recreate (no ALTER migration). */
  const cols = db.prepare(`PRAGMA table_info(wiki_shares)`).all() as { name: string }[]
  if (cols.length > 0 && !cols.some((c) => c.name === 'target_kind')) {
    db.exec(`DROP TABLE wiki_shares`)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_shares (
      id               TEXT PRIMARY KEY,
      owner_id         TEXT NOT NULL,
      grantee_email    TEXT NOT NULL,
      grantee_id       TEXT,
      path_prefix      TEXT NOT NULL,
      target_kind      TEXT NOT NULL DEFAULT 'dir',
      invite_token     TEXT NOT NULL UNIQUE,
      created_at_ms    INTEGER NOT NULL,
      accepted_at_ms  INTEGER,
      revoked_at_ms    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_shares_owner ON wiki_shares(owner_id);
    CREATE INDEX IF NOT EXISTS idx_wiki_shares_grantee ON wiki_shares(grantee_id);
    CREATE INDEX IF NOT EXISTS idx_wiki_shares_token ON wiki_shares(invite_token);
  `)
}

/** Lazily opens the global DB (WAL). */
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
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  ensureBrainGlobalSchema(db)
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
