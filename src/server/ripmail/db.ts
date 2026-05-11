/**
 * Open and initialize the ripmail SQLite database for a tenant.
 *
 * - DB path: `<ripmail_home>/ripmail.db` (unchanged from Rust)
 * - Schema version stored in `user_version` PRAGMA
 * - On version mismatch: {@link openRipmailDb} throws {@link RipmailDbSchemaDriftError}; callers
 *   await {@link prepareRipmailDb} to wipe SQLite, repopulate from maildirs (no SQLite migrations).
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { brainLayoutRipmailDir } from '@server/lib/platform/brainLayout.js'
import { readHandleMeta, isValidUserId } from '@server/lib/tenant/handleMeta.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema.js'
import { runRipmailRepopulateChild } from './runRipmailRepopulateChild.js'

export type RipmailDb = Database.Database

/** `user_version` while a maildir repopulate is incomplete. Next open treats this as drift. */
export const RIPMAIL_DB_USER_VERSION_PENDING = 0

/** Thrown when on-disk DB `user_version` does not match {@link SCHEMA_VERSION}. Use {@link prepareRipmailDb}. */
export class RipmailDbSchemaDriftError extends Error {
  readonly ripmailHome: string
  readonly storedVersion: number
  readonly expectedVersion: number
  constructor(ripmailHome: string, storedVersion: number, expectedVersion: number) {
    super(`ripmail: schema drift for ${ripmailHome} — user_version=${storedVersion} expected=${expectedVersion}`)
    this.name = 'RipmailDbSchemaDriftError'
    this.ripmailHome = ripmailHome
    this.storedVersion = storedVersion
    this.expectedVersion = expectedVersion
  }
}

/**
 * Map from ripmail home path to open DB connection.
 * One connection per home — ripmail DB is single-writer, single-process.
 */
const dbCache = new Map<string, RipmailDb>()

const prepareRipmailInflight = new Map<string, Promise<RipmailDb>>()

/** Fields for NR / ops when SQLite is wiped for schema drift (best-effort if no tenant ALS). */
type RipmailRebuildLogFields = {
  tenantUserId?: string
  workspaceHandle?: string
}

async function resolveRipmailRebuildLogContext(ripmailHome: string): Promise<RipmailRebuildLogFields> {
  const absRipmail = resolve(ripmailHome)
  const ctx = tryGetTenantContext()
  if (ctx && resolve(brainLayoutRipmailDir(ctx.homeDir)) === absRipmail) {
    return { tenantUserId: ctx.tenantUserId, workspaceHandle: ctx.workspaceHandle }
  }
  const tenantHome = dirname(absRipmail)
  const dirName = basename(tenantHome)
  let tenantUserId: string | undefined =
    dirName === '_single' || isValidUserId(dirName) ? dirName : undefined
  const meta = await readHandleMeta(tenantHome)
  const workspaceHandle = meta?.handle
  if (!tenantUserId && meta?.userId && isValidUserId(meta.userId)) {
    tenantUserId = meta.userId
  }
  return { tenantUserId, workspaceHandle }
}

/** Path to `ripmail.db` inside a ripmail home dir. */
export function ripmailDbPath(ripmailHome: string): string {
  return join(ripmailHome, 'ripmail.db')
}

function applySchemaTables(db: RipmailDb): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const stmt of SCHEMA_STATEMENTS) {
    db.exec(stmt)
  }
  db.prepare(`INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (1, 0)`).run()
  db.prepare(`INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (2, 0)`).run()
}

export function markRipmailDbSchemaReady(db: RipmailDb): void {
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

function applySchema(db: RipmailDb): void {
  applySchemaTables(db)
  markRipmailDbSchemaReady(db)
}

export function markRipmailDbSchemaPending(db: RipmailDb): void {
  db.pragma(`user_version = ${RIPMAIL_DB_USER_VERSION_PENDING}`)
}

function applySchemaPending(db: RipmailDb): void {
  applySchemaTables(db)
  markRipmailDbSchemaPending(db)
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

/** Open a DB for a rebuild without putting an incomplete connection in the process cache. */
export function openRipmailDbForRepopulate(ripmailHome: string): RipmailDb {
  mkdirSync(ripmailHome, { recursive: true })
  const db = new Database(ripmailDbPath(ripmailHome))
  applySchemaPending(db)
  return db
}

function hasMaildirCache(ripmailHome: string): boolean {
  try {
    if (statSync(join(ripmailHome, 'maildir')).isDirectory()) return true
  } catch {
    /* ignore */
  }

  let entries
  try {
    entries = readdirSync(ripmailHome, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    try {
      if (statSync(join(ripmailHome, entry.name, 'maildir')).isDirectory()) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

function removeRipmailDbArtifacts(dbPath: string): void {
  for (const p of [`${dbPath}-wal`, `${dbPath}-shm`, dbPath]) {
    try {
      rmSync(p, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * Open (or return cached) the ripmail DB for `ripmailHome`.
 * Creates the directory and DB file if they don't exist.
 * On **`user_version` mismatch**, closes and throws {@link RipmailDbSchemaDriftError} — use {@link prepareRipmailDb}.
 */
export function openRipmailDb(ripmailHome: string): RipmailDb {
  const cached = dbCache.get(ripmailHome)
  if (cached && cached.open) return cached

  mkdirSync(ripmailHome, { recursive: true })
  const dbPath = ripmailDbPath(ripmailHome)

  let db: RipmailDb

  if (!existsSync(dbPath)) {
    if (hasMaildirCache(ripmailHome)) {
      throw new RipmailDbSchemaDriftError(
        ripmailHome,
        RIPMAIL_DB_USER_VERSION_PENDING,
        SCHEMA_VERSION,
      )
    }
    db = openFresh(dbPath)
    brainLogger.debug({ ripmailHome, schemaVersion: SCHEMA_VERSION }, 'ripmail:db:created')
  } else {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const stored = db.pragma('user_version', { simple: true }) as number
    if (stored !== SCHEMA_VERSION) {
      try {
        db.close()
      } catch {
        /* ignore */
      }
      throw new RipmailDbSchemaDriftError(ripmailHome, stored, SCHEMA_VERSION)
    }
    seedSyncSummaryRows(db)
  }

  dbCache.set(ripmailHome, db)
  return db
}

/**
 * Opens the ripmail DB after ensuring schema matches: on drift, wipes SQLite artifacts and awaits
 * maildir repopulation in a child process.
 * Concurrent calls for the same `ripmailHome` share one prepare operation.
 */
export async function prepareRipmailDb(ripmailHome: string): Promise<RipmailDb> {
  let flight = prepareRipmailInflight.get(ripmailHome)
  if (flight) return flight

  flight = doPrepareRipmailDb(ripmailHome)
  prepareRipmailInflight.set(ripmailHome, flight)
  try {
    return await flight
  } finally {
    prepareRipmailInflight.delete(ripmailHome)
  }
}

async function doPrepareRipmailDb(ripmailHome: string): Promise<RipmailDb> {
  try {
    return openRipmailDb(ripmailHome)
  } catch (e) {
    if (!(e instanceof RipmailDbSchemaDriftError)) throw e
    const rebuildLog = await resolveRipmailRebuildLogContext(e.ripmailHome)
    brainLogger.warn(
      {
        ripmailHome: e.ripmailHome,
        stored: e.storedVersion,
        expected: e.expectedVersion,
        ...rebuildLog,
      },
      'ripmail:db:version-mismatch — wiping and rebuilding from maildir cache',
    )
    invalidateRipmailDbCache(e.ripmailHome)
    removeRipmailDbArtifacts(ripmailDbPath(e.ripmailHome))
    await runRipmailRepopulateChild(e.ripmailHome, {
      ripmailHome: e.ripmailHome,
      stored: e.storedVersion,
      expected: e.expectedVersion,
      ...rebuildLog,
    })
    brainLogger.info(
      {
        ripmailHome: e.ripmailHome,
        schemaVersion: SCHEMA_VERSION,
        ...rebuildLog,
      },
      'ripmail:db:rebuild-complete — maildir repopulation finished',
    )
    return openRipmailDb(ripmailHome)
  }
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
