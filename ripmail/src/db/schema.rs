//! SQL schema — mirrors `src/db/schema.ts` in the TypeScript tree.

pub const SCHEMA_VERSION: i32 = 29;

pub const SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS sources (
    id                  TEXT NOT NULL PRIMARY KEY,
    kind                TEXT NOT NULL,
    label               TEXT,
    include_in_default  INTEGER NOT NULL DEFAULT 1,
    last_synced_at      TEXT,
    doc_count           INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id   TEXT NOT NULL UNIQUE,
    thread_id    TEXT NOT NULL,
    folder       TEXT NOT NULL,
    uid          INTEGER NOT NULL,
    labels       TEXT NOT NULL DEFAULT '[]',
    category     TEXT,
    from_address TEXT NOT NULL,
    from_name    TEXT,
    to_addresses TEXT NOT NULL DEFAULT '[]',
    cc_addresses TEXT NOT NULL DEFAULT '[]',
    to_recipients TEXT NOT NULL DEFAULT '[]',
    cc_recipients TEXT NOT NULL DEFAULT '[]',
    subject      TEXT NOT NULL DEFAULT '',
    date         TEXT NOT NULL,
    body_text    TEXT NOT NULL DEFAULT '',
    raw_path     TEXT NOT NULL,
    source_id    TEXT NOT NULL DEFAULT '',
    is_archived  INTEGER NOT NULL DEFAULT 0,
    synced_at    TEXT NOT NULL DEFAULT (datetime('now')),
    rule_triage  TEXT NOT NULL DEFAULT 'pending' CHECK (rule_triage IN ('pending', 'assigned')),
    winning_rule_id TEXT,
    is_reply         INTEGER NOT NULL DEFAULT 0,
    recipient_count  INTEGER NOT NULL DEFAULT 0,
    list_like        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS threads (
    thread_id          TEXT PRIMARY KEY,
    subject            TEXT NOT NULL DEFAULT '',
    participant_count  INTEGER NOT NULL DEFAULT 1,
    message_count      INTEGER NOT NULL DEFAULT 1,
    last_message_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id      TEXT NOT NULL REFERENCES messages(message_id),
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size            INTEGER NOT NULL DEFAULT 0,
    stored_path     TEXT NOT NULL,
    extracted_text  TEXT
  );

  CREATE TABLE IF NOT EXISTS people (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name  TEXT,
    aka             TEXT NOT NULL DEFAULT '[]',
    primary_address TEXT NOT NULL,
    addresses       TEXT NOT NULL DEFAULT '[]',
    phone           TEXT,
    title           TEXT,
    company         TEXT,
    urls            TEXT NOT NULL DEFAULT '[]',
    sent_count      INTEGER NOT NULL DEFAULT 0,
    received_count  INTEGER NOT NULL DEFAULT 0,
    mentioned_count INTEGER NOT NULL DEFAULT 0,
    last_contact    TEXT,
    is_noreply      INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_people_name ON people(canonical_name);

  CREATE TABLE IF NOT EXISTS sync_state (
    source_id    TEXT NOT NULL DEFAULT '',
    folder       TEXT NOT NULL,
    uidvalidity  INTEGER NOT NULL,
    last_uid     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source_id, folder)
  );

  CREATE TABLE IF NOT EXISTS sync_windows (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id        TEXT NOT NULL DEFAULT '',
    phase            INTEGER NOT NULL,
    window_start     TEXT NOT NULL,
    window_end       TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    messages_found   INTEGER NOT NULL DEFAULT 0,
    messages_synced  INTEGER NOT NULL DEFAULT 0,
    started_at       TEXT,
    completed_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS source_sync_meta (
    source_id                    TEXT NOT NULL PRIMARY KEY,
    first_backfill_completed_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_summary (
    id                   INTEGER PRIMARY KEY CHECK (id IN (1, 2)),
    earliest_synced_date TEXT,
    latest_synced_date   TEXT,
    target_start_date    TEXT,
    sync_start_earliest_date TEXT,
    total_messages       INTEGER NOT NULL DEFAULT 0,
    last_sync_at         TEXT,
    is_running           INTEGER NOT NULL DEFAULT 0,
    owner_pid            INTEGER,
    sync_lock_started_at TEXT
  );

  CREATE TABLE IF NOT EXISTS inbox_scans (
    scan_id            TEXT PRIMARY KEY,
    mode               TEXT NOT NULL,
    cutoff_iso         TEXT NOT NULL,
    scanned_at         TEXT NOT NULL DEFAULT (datetime('now')),
    notable_count      INTEGER NOT NULL DEFAULT 0,
    candidates_scanned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS inbox_alerts (
    message_id   TEXT NOT NULL REFERENCES messages(message_id),
    surfaced_at  TEXT NOT NULL DEFAULT (datetime('now')),
    scan_id      TEXT NOT NULL REFERENCES inbox_scans(scan_id),
    PRIMARY KEY (message_id)
  );

  CREATE TABLE IF NOT EXISTS inbox_reviews (
    message_id   TEXT NOT NULL REFERENCES messages(message_id),
    surfaced_at  TEXT NOT NULL DEFAULT (datetime('now')),
    scan_id      TEXT NOT NULL REFERENCES inbox_scans(scan_id),
    PRIMARY KEY (message_id)
  );

  CREATE TABLE IF NOT EXISTS inbox_decisions (
    message_id              TEXT NOT NULL REFERENCES messages(message_id),
    rules_fingerprint       TEXT NOT NULL,
    action                  TEXT NOT NULL CHECK(action IN ('notify', 'inform', 'ignore')),
    matched_rule_ids        TEXT NOT NULL DEFAULT '[]',
    note                    TEXT,
    decision_source         TEXT NOT NULL,
    decided_at              TEXT NOT NULL DEFAULT (datetime('now')),
    requires_user_action    INTEGER NOT NULL DEFAULT 0,
    action_summary          TEXT,
    PRIMARY KEY (message_id, rules_fingerprint)
  );

  CREATE TABLE IF NOT EXISTS files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id       TEXT NOT NULL,
    rel_path        TEXT NOT NULL,
    abs_path        TEXT NOT NULL,
    mtime           INTEGER NOT NULL,
    size            INTEGER NOT NULL,
    mime            TEXT,
    title           TEXT,
    body_text       TEXT NOT NULL DEFAULT '',
    UNIQUE(source_id, rel_path)
  );

  CREATE TABLE IF NOT EXISTS document_index (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id  TEXT NOT NULL,
    kind       TEXT NOT NULL,
    ext_id     TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    date_iso   TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_document_index_source ON document_index(source_id);
  CREATE INDEX IF NOT EXISTS idx_document_index_kind_ext ON document_index(kind, ext_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS document_index_fts USING fts5(
    title,
    body,
    source_id UNINDEXED,
    kind UNINDEXED,
    ext_id UNINDEXED,
    date_iso UNINDEXED,
    content='document_index',
    content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS document_index_fts_insert
    AFTER INSERT ON document_index BEGIN
      INSERT INTO document_index_fts(rowid, title, body, source_id, kind, ext_id, date_iso)
      VALUES (new.id, new.title, new.body, new.source_id, new.kind, new.ext_id, new.date_iso);
    END;

  CREATE TRIGGER IF NOT EXISTS document_index_fts_delete
    AFTER DELETE ON document_index BEGIN
      INSERT INTO document_index_fts(document_index_fts, rowid, title, body, source_id, kind, ext_id, date_iso)
      VALUES ('delete', old.id, old.title, old.body, old.source_id, old.kind, old.ext_id, old.date_iso);
    END;

  CREATE TRIGGER IF NOT EXISTS document_index_fts_update
    AFTER UPDATE ON document_index BEGIN
      INSERT INTO document_index_fts(document_index_fts, rowid, title, body, source_id, kind, ext_id, date_iso)
      VALUES ('delete', old.id, old.title, old.body, old.source_id, old.kind, old.ext_id, old.date_iso);
      INSERT INTO document_index_fts(rowid, title, body, source_id, kind, ext_id, date_iso)
      VALUES (new.id, new.title, new.body, new.source_id, new.kind, new.ext_id, new.date_iso);
    END;

  CREATE TRIGGER IF NOT EXISTS messages_document_ai
    AFTER INSERT ON messages BEGIN
      INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
      VALUES (new.source_id, 'mail', new.message_id, new.subject, new.body_text, new.date);
    END;

  CREATE TRIGGER IF NOT EXISTS messages_document_au
    AFTER UPDATE ON messages BEGIN
      DELETE FROM document_index WHERE kind = 'mail' AND ext_id = old.message_id;
      INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
      VALUES (new.source_id, 'mail', new.message_id, new.subject, new.body_text, new.date);
    END;

  CREATE TRIGGER IF NOT EXISTS messages_document_ad
    AFTER DELETE ON messages BEGIN
      DELETE FROM document_index WHERE kind = 'mail' AND ext_id = old.message_id;
    END;

  CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_messages_date    ON messages(date DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_folder  ON messages(folder, uid);
  CREATE INDEX IF NOT EXISTS idx_messages_archived ON messages(is_archived) WHERE is_archived = 1;
  CREATE INDEX IF NOT EXISTS idx_messages_category ON messages(category) WHERE category IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_attachments_msg  ON attachments(message_id);
  CREATE INDEX IF NOT EXISTS idx_inbox_alerts_message ON inbox_alerts(message_id);
  CREATE INDEX IF NOT EXISTS idx_inbox_reviews_message ON inbox_reviews(message_id);
  CREATE INDEX IF NOT EXISTS idx_inbox_decisions_message ON inbox_decisions(message_id);
  CREATE INDEX IF NOT EXISTS idx_messages_rule_triage_pending ON messages(rule_triage) WHERE rule_triage = 'pending';
  CREATE INDEX IF NOT EXISTS idx_messages_source_id ON messages(source_id);

  CREATE TABLE IF NOT EXISTS calendar_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id       TEXT NOT NULL,
    source_kind     TEXT NOT NULL,
    calendar_id     TEXT NOT NULL,
    calendar_name   TEXT,
    uid             TEXT NOT NULL,
    summary         TEXT,
    description     TEXT,
    location        TEXT,
    start_at        INTEGER NOT NULL,
    end_at          INTEGER NOT NULL,
    all_day         INTEGER NOT NULL DEFAULT 0,
    timezone        TEXT,
    status          TEXT,
    rrule           TEXT,
    recurrence_json TEXT,
    attendees_json  TEXT,
    organizer_email TEXT,
    organizer_name  TEXT,
    updated_at      INTEGER,
    synced_at       INTEGER NOT NULL,
    color           TEXT,
    raw_json        TEXT,
    UNIQUE(source_id, uid)
  );

  CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source_id);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON calendar_events(start_at, end_at);

  CREATE VIRTUAL TABLE IF NOT EXISTS calendar_events_fts USING fts5(
    summary,
    description,
    location,
    organizer_email,
    organizer_name,
    content='calendar_events',
    content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS calendar_events_fts_insert
    AFTER INSERT ON calendar_events BEGIN
      INSERT INTO calendar_events_fts(rowid, summary, description, location, organizer_email, organizer_name)
      VALUES (new.id, new.summary, new.description, new.location, new.organizer_email, new.organizer_name);
    END;

  CREATE TRIGGER IF NOT EXISTS calendar_events_fts_delete
    AFTER DELETE ON calendar_events BEGIN
      INSERT INTO calendar_events_fts(calendar_events_fts, rowid, summary, description, location, organizer_email, organizer_name)
      VALUES ('delete', old.id, old.summary, old.description, old.location, old.organizer_email, old.organizer_name);
    END;

  CREATE TRIGGER IF NOT EXISTS calendar_events_fts_update
    AFTER UPDATE ON calendar_events BEGIN
      INSERT INTO calendar_events_fts(calendar_events_fts, rowid, summary, description, location, organizer_email, organizer_name)
      VALUES ('delete', old.id, old.summary, old.description, old.location, old.organizer_email, old.organizer_name);
      INSERT INTO calendar_events_fts(rowid, summary, description, location, organizer_email, organizer_name)
      VALUES (new.id, new.summary, new.description, new.location, new.organizer_email, new.organizer_name);
    END;

  CREATE TABLE IF NOT EXISTS calendar_sync_state (
    source_id    TEXT NOT NULL,
    calendar_id  TEXT NOT NULL,
    sync_token   TEXT,
    synced_at    INTEGER,
    PRIMARY KEY (source_id, calendar_id)
  );

  CREATE TABLE IF NOT EXISTS google_drive_sync_state (
    source_id          TEXT NOT NULL PRIMARY KEY,
    change_page_token  TEXT,
    last_synced_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS cloud_file_meta (
    source_id       TEXT NOT NULL,
    remote_id       TEXT NOT NULL,
    content_hash    TEXT,
    remote_mtime    TEXT,
    cached_md_path  TEXT,
    PRIMARY KEY (source_id, remote_id)
  );
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_has_core_objects() {
        assert!(SCHEMA.contains("CREATE TABLE IF NOT EXISTS messages"));
        assert!(SCHEMA.contains("document_index_fts"));
        assert!(SCHEMA.contains("source_id"));
        assert!(SCHEMA.contains("PRIMARY KEY (source_id, folder)"));
        assert!(SCHEMA.contains("source_sync_meta"));
        assert!(SCHEMA.contains("calendar_events"));
        assert!(SCHEMA.contains("calendar_sync_state"));
        assert!(SCHEMA.contains("google_drive_sync_state"));
        assert!(SCHEMA.contains("cloud_file_meta"));
    }
}
