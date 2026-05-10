/**
 * Open and initialize the ripmail SQLite database for a tenant.
 *
 * - DB path: `<ripmail_home>/ripmail.db` (unchanged from Rust)
 * - Schema version stored in `user_version` PRAGMA
 * - On version mismatch: wipe and recreate (no migrations — early dev convention)
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema.js'

export type RipmailDb = Database.Database

/**
 * Map from ripmail home path to open DB connection.
 * One connection per home — ripmail DB is single-writer, single-process.
 */
const dbCache = new Map<string, RipmailDb>()

/** Path to `ripmail.db` inside a ripmail home dir. */
export function ripmailDbPath(ripmailHome: string): string {
  return join(ripmailHome, 'ripmail.db')
}

function applySchema(db: RipmailDb): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const stmt of SCHEMA_STATEMENTS) {
    db.exec(stmt)
  }
  db.prepare(`INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (1, 0)`).run()
  db.prepare(`INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (2, 0)`).run()
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

/** Ensure refresh/backfill lock rows exist (matches Rust bootstrap). */
export function seedSyncSummaryRows(db: RipmailDb): void {
  db.prepare(`INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (1, 0)`).run()
  db.prepare(`INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (2, 0)`).run()
}

function openFresh(dbPath: string): RipmailDb {
  const db = new Database(dbPath)
  applySchema(db)
  return db
}

/**
 * Open (or return cached) the ripmail DB for `ripmailHome`.
 * Creates the directory and DB file if they don't exist.
 * Wipes + recreates the DB when schema version doesn't match.
 */
export function openRipmailDb(ripmailHome: string): RipmailDb {
  const cached = dbCache.get(ripmailHome)
  if (cached && cached.open) return cached

  mkdirSync(ripmailHome, { recursive: true })
  const dbPath = ripmailDbPath(ripmailHome)

  let db: RipmailDb

  if (!existsSync(dbPath)) {
    db = openFresh(dbPath)
    brainLogger.debug({ ripmailHome, schemaVersion: SCHEMA_VERSION }, 'ripmail:db:created')
  } else {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const stored = db.pragma('user_version', { simple: true }) as number
    if (stored !== SCHEMA_VERSION) {
      brainLogger.warn(
        { ripmailHome, stored, expected: SCHEMA_VERSION },
        'ripmail:db:version-mismatch — wiping and recreating',
      )
      db.close()
      rmSync(dbPath)
      db = openFresh(dbPath)
    } else {
      seedSyncSummaryRows(db)
    }
  }

  dbCache.set(ripmailHome, db)
  return db
}

/**
 * Close and remove a cached DB connection (e.g. after a wipe).
 */
export function closeRipmailDb(ripmailHome: string): void {
  const db = dbCache.get(ripmailHome)
  if (db) {
    try {
      db.close()
    } catch {
      // ignore
    }
    dbCache.delete(ripmailHome)
  }
}

/** Invalidate cached connection when the underlying file has been replaced. */
export function invalidateRipmailDbCache(ripmailHome: string): void {
  closeRipmailDb(ripmailHome)
}

/**
 * Open an in-memory DB with the full schema applied.
 * Used in tests that don't need a file on disk.
 */
export function openMemoryRipmailDb(): RipmailDb {
  const db = new Database(':memory:')
  applySchema(db)
  return db
}
