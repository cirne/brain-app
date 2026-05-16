import Database from 'better-sqlite3'
import { mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { globalDir } from '@server/lib/tenant/dataRoot.js'

/**
 * Bump when `brain-global.sqlite` layout changes. Older files are deleted and recreated (no ALTER migrations).
 * Version 9: `brain_query_custom_policies` + grants use XOR `preset_policy_key` | `custom_policy_id`; file recreated.
 * Version 10: `brain_query_custom_policies.label` → `title` (display title for custom policies); file recreated.
 * Version 11: Slack workspace install + per-user Slack identity links (OPP-117).
 */
export const BRAIN_GLOBAL_SCHEMA_VERSION = 11

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
CREATE TABLE brain_query_custom_policies (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at_ms   INTEGER NOT NULL,
  updated_at_ms   INTEGER NOT NULL
);
CREATE INDEX idx_brain_query_custom_policies_owner ON brain_query_custom_policies(owner_id);

CREATE TABLE brain_query_grants (
  id                   TEXT PRIMARY KEY,
  owner_id             TEXT NOT NULL,
  asker_id             TEXT NOT NULL,
  preset_policy_key    TEXT,
  custom_policy_id     TEXT REFERENCES brain_query_custom_policies(id),
  reply_mode           TEXT NOT NULL DEFAULT 'review' CHECK (reply_mode IN ('auto', 'review', 'ignore')),
  created_at_ms        INTEGER NOT NULL,
  updated_at_ms        INTEGER NOT NULL,
  revoked_at_ms        INTEGER,
  UNIQUE(owner_id, asker_id)
);
CREATE INDEX idx_brain_query_grants_owner ON brain_query_grants(owner_id);
CREATE INDEX idx_brain_query_grants_asker ON brain_query_grants(asker_id);
CREATE INDEX idx_brain_query_grants_custom_policy ON brain_query_grants(custom_policy_id);

CREATE TABLE cold_query_rate_limits (
  sender_handle    TEXT NOT NULL,
  receiver_handle  TEXT NOT NULL,
  sent_at_ms       INTEGER NOT NULL,
  PRIMARY KEY (sender_handle, receiver_handle)
);

CREATE TABLE slack_workspaces (
  slack_team_id              TEXT PRIMARY KEY,
  team_name                  TEXT NOT NULL,
  installer_tenant_user_id   TEXT NOT NULL,
  bot_token                  TEXT NOT NULL,
  installed_at_ms            INTEGER NOT NULL
);

CREATE TABLE slack_user_links (
  slack_team_id    TEXT NOT NULL,
  slack_user_id    TEXT NOT NULL,
  tenant_user_id   TEXT NOT NULL,
  slack_email      TEXT,
  linked_at_ms     INTEGER NOT NULL,
  PRIMARY KEY (slack_team_id, slack_user_id)
);
CREATE INDEX idx_slack_user_links_tenant ON slack_user_links(tenant_user_id);
CREATE INDEX idx_slack_user_links_team ON slack_user_links(slack_team_id);
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
  db.pragma('foreign_keys = ON')
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
