//! SQLite access — file-backed, WAL, FTS5 (mirrors TS `~/db`).
//!
//! **Read vs write connections:** Query-only paths should use [`open_file_for_queries`] or
//! [`open_file_readonly`] after the index file exists; sync/inbox/archive and attachment cache
//! paths need [`open_file`]. See `docs/ARCHITECTURE.md` (ADR-026 and “SQLite read vs write
//! operations”).

pub mod message_persist;
pub mod schema;

use rusqlite::{Connection, OpenFlags};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::Duration;

use schema::SCHEMA;
pub use schema::SCHEMA_VERSION;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("rusqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    InvalidInput(String),
}

/// Total attempts when opening the writable index hits `SQLITE_BUSY` / `SQLITE_LOCKED`.
const RW_OPEN_BUSY_ATTEMPTS: usize = 3;
/// Delay before retrying a blocked writable open (after the first failure).
const RW_OPEN_BUSY_SLEEP: Duration = Duration::from_secs(1);

fn sqlite_busy_or_locked(err: &rusqlite::Error) -> bool {
    matches!(
        err,
        rusqlite::Error::SqliteFailure(sql_err, _)
            if sql_err.code == rusqlite::ErrorCode::DatabaseBusy
                || sql_err.code == rusqlite::ErrorCode::DatabaseLocked
    )
}

fn db_error_busy_or_locked(err: &DbError) -> bool {
    match err {
        DbError::Sqlite(inner) => sqlite_busy_or_locked(inner),
        _ => false,
    }
}

/// Retry on SQLite busy/locked when opening or upgrading the writable index (`open_file`).
pub(crate) fn retry_on_busy<T, F>(mut f: F) -> Result<T, DbError>
where
    F: FnMut() -> Result<T, DbError>,
{
    for attempt in 0..RW_OPEN_BUSY_ATTEMPTS {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) if db_error_busy_or_locked(&e) && attempt + 1 < RW_OPEN_BUSY_ATTEMPTS => {
                sleep(RW_OPEN_BUSY_SLEEP);
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!("retry_on_busy: loop always returns Ok or Err");
}

fn apply_connection_pragmas(conn: &Connection) -> Result<(), DbError> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 15_000i32)?;
    Ok(())
}

fn read_user_version(path: &Path) -> Result<Option<i32>, DbError> {
    if !path.exists() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    apply_connection_pragmas(&conn)?;
    let version = conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))?;
    Ok(Some(version))
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct SyncCheckpointRow {
    /// `sync_state.source_id` (legacy DBs stored this as `mailbox_id`).
    source_id: String,
    folder: String,
    uidvalidity: i64,
    last_uid: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct SyncSummarySnapshot {
    earliest_synced_date: Option<String>,
    latest_synced_date: Option<String>,
    target_start_date: Option<String>,
    sync_start_earliest_date: Option<String>,
    last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct InboxSurfacedRow {
    message_id: String,
    surfaced_at: String,
    scan_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct InboxDecisionRow {
    message_id: String,
    rules_fingerprint: String,
    action: String,
    matched_rule_ids: String,
    note: Option<String>,
    decision_source: String,
    decided_at: String,
    requires_user_action: i64,
    action_summary: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct InboxStateSnapshot {
    scans: Vec<(String, String, String, String, i64, i64)>,
    alerts: Vec<InboxSurfacedRow>,
    reviews: Vec<InboxSurfacedRow>,
    decisions: Vec<InboxDecisionRow>,
}

fn sync_state_has_column(conn: &Connection, col: &str) -> Result<bool, DbError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('sync_state') WHERE name = ?1",
        [col],
        |row| row.get(0),
    )?;
    Ok(n >= 1)
}

fn load_sync_checkpoints(conn: &Connection) -> Result<Vec<SyncCheckpointRow>, DbError> {
    let has_source_id = sync_state_has_column(conn, "source_id")?;
    let has_legacy_mailbox_id = sync_state_has_column(conn, "mailbox_id")?;
    let sql = if has_source_id {
        "SELECT source_id, folder, uidvalidity, last_uid FROM sync_state ORDER BY source_id, folder"
    } else if has_legacy_mailbox_id {
        "SELECT mailbox_id, folder, uidvalidity, last_uid FROM sync_state ORDER BY mailbox_id, folder"
    } else {
        "SELECT folder, uidvalidity, last_uid FROM sync_state ORDER BY folder"
    };
    let mut stmt = match conn.prepare(sql) {
        Ok(stmt) => stmt,
        Err(rusqlite::Error::SqliteFailure(err, _)) if err.extended_code == 1 => {
            return Ok(Vec::new());
        }
        Err(err) => return Err(err.into()),
    };
    let rows = if has_source_id || has_legacy_mailbox_id {
        stmt.query_map([], |row| {
            Ok(SyncCheckpointRow {
                source_id: row.get(0)?,
                folder: row.get(1)?,
                uidvalidity: row.get(2)?,
                last_uid: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map([], |row| {
            Ok(SyncCheckpointRow {
                source_id: String::new(),
                folder: row.get(0)?,
                uidvalidity: row.get(1)?,
                last_uid: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

fn load_sync_summary_snapshot(conn: &Connection) -> Result<SyncSummarySnapshot, DbError> {
    let row = match conn.query_row(
            "SELECT earliest_synced_date, latest_synced_date, target_start_date, sync_start_earliest_date, last_sync_at
             FROM sync_summary WHERE id = 1",
            [],
            |row| {
                Ok(SyncSummarySnapshot {
                    earliest_synced_date: row.get(0)?,
                    latest_synced_date: row.get(1)?,
                    target_start_date: row.get(2)?,
                    sync_start_earliest_date: row.get(3)?,
                    last_sync_at: row.get(4)?,
                })
            },
        ) {
        Ok(row) => Some(row),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(rusqlite::Error::SqliteFailure(err, _)) if err.extended_code == 1 => None,
        Err(err) => return Err(err.into()),
    };
    Ok(row.unwrap_or_default())
}

fn query_table_exists(conn: &Connection, table_name: &str) -> Result<bool, DbError> {
    let exists = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table_name],
        |row| row.get::<_, i64>(0),
    )? == 1;
    Ok(exists)
}

/// True when `inbox_decisions` has v17+ columns (schema drift rebuild reads a stale DB).
fn inbox_decisions_has_action_columns(conn: &Connection) -> Result<bool, DbError> {
    if !query_table_exists(conn, "inbox_decisions")? {
        return Ok(false);
    }
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('inbox_decisions') WHERE name IN ('requires_user_action', 'action_summary')",
        [],
        |row| row.get(0),
    )?;
    Ok(n >= 2)
}

fn load_surfaced_rows(
    conn: &Connection,
    table_name: &str,
) -> Result<Vec<InboxSurfacedRow>, DbError> {
    if !query_table_exists(conn, table_name)? {
        return Ok(Vec::new());
    }
    let sql =
        format!("SELECT message_id, surfaced_at, scan_id FROM {table_name} ORDER BY message_id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(InboxSurfacedRow {
                message_id: row.get(0)?,
                surfaced_at: row.get(1)?,
                scan_id: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_inbox_state_snapshot(conn: &Connection) -> Result<InboxStateSnapshot, DbError> {
    if !query_table_exists(conn, "inbox_scans")? {
        return Ok(InboxStateSnapshot::default());
    }

    let mut scan_stmt = conn.prepare(
        "SELECT scan_id, mode, cutoff_iso, scanned_at, notable_count, candidates_scanned
         FROM inbox_scans
         ORDER BY scan_id",
    )?;
    let scans = scan_stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let alerts = load_surfaced_rows(conn, "inbox_alerts")?;
    let reviews = load_surfaced_rows(conn, "inbox_reviews")?;

    let decisions = if query_table_exists(conn, "inbox_decisions")? {
        if inbox_decisions_has_action_columns(conn)? {
            let mut decisions_stmt = conn.prepare(
                "SELECT message_id, rules_fingerprint, action, matched_rule_ids, note, decision_source, decided_at,
                        requires_user_action, action_summary
                 FROM inbox_decisions
                 ORDER BY message_id, rules_fingerprint",
            )?;
            let rows = decisions_stmt
                .query_map([], |row| {
                    Ok(InboxDecisionRow {
                        message_id: row.get(0)?,
                        rules_fingerprint: row.get(1)?,
                        action: row.get(2)?,
                        matched_rule_ids: row.get(3)?,
                        note: row.get(4)?,
                        decision_source: row.get(5)?,
                        decided_at: row.get(6)?,
                        requires_user_action: row.get(7)?,
                        action_summary: row.get(8)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        } else {
            let mut decisions_stmt = conn.prepare(
                "SELECT message_id, rules_fingerprint, action, matched_rule_ids, note, decision_source, decided_at
                 FROM inbox_decisions
                 ORDER BY message_id, rules_fingerprint",
            )?;
            let rows = decisions_stmt
                .query_map([], |row| {
                    Ok(InboxDecisionRow {
                        message_id: row.get(0)?,
                        rules_fingerprint: row.get(1)?,
                        action: row.get(2)?,
                        matched_rule_ids: row.get(3)?,
                        note: row.get(4)?,
                        decision_source: row.get(5)?,
                        decided_at: row.get(6)?,
                        requires_user_action: 0,
                        action_summary: None,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        }
    } else {
        Vec::new()
    };

    Ok(InboxStateSnapshot {
        scans,
        alerts,
        reviews,
        decisions,
    })
}

fn normalize_inbox_decision_action(action: &str) -> &'static str {
    match action {
        "notify" => "notify",
        "inform" => "inform",
        "ignore" => "ignore",
        _ => "ignore",
    }
}

fn restore_sync_metadata(
    conn: &Connection,
    checkpoints: &[SyncCheckpointRow],
    summary: &SyncSummarySnapshot,
) -> Result<(), DbError> {
    for checkpoint in checkpoints {
        conn.execute(
            "INSERT OR REPLACE INTO sync_state (source_id, folder, uidvalidity, last_uid) VALUES (?1, ?2, ?3, ?4)",
            (
                &checkpoint.source_id,
                &checkpoint.folder,
                checkpoint.uidvalidity,
                checkpoint.last_uid,
            ),
        )?;
    }
    conn.execute(
        "UPDATE sync_summary
         SET earliest_synced_date = COALESCE(?1, (SELECT MIN(date) FROM messages)),
             latest_synced_date = COALESCE(?2, (SELECT MAX(date) FROM messages)),
             target_start_date = ?3,
             sync_start_earliest_date = ?4,
             total_messages = (SELECT COUNT(*) FROM messages),
             last_sync_at = ?5,
             is_running = 0,
             owner_pid = NULL,
             sync_lock_started_at = NULL
         WHERE id = 1",
        (
            summary.earliest_synced_date.as_deref(),
            summary.latest_synced_date.as_deref(),
            summary.target_start_date.as_deref(),
            summary.sync_start_earliest_date.as_deref(),
            summary.last_sync_at.as_deref(),
        ),
    )?;
    Ok(())
}

fn message_row_exists(conn: &Connection, message_id: &str) -> Result<bool, DbError> {
    let ok: i64 = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE message_id = ?1)",
        [message_id],
        |r| r.get(0),
    )?;
    Ok(ok != 0)
}

/// After maildir rebuild, `messages` may be a strict subset of the pre-rebuild snapshot (e.g. empty
/// maildir). Inbox rows reference `messages(message_id)`; skip orphans so `FOREIGN KEY` does not fail.
fn restore_inbox_state(conn: &Connection, inbox: &InboxStateSnapshot) -> Result<(), DbError> {
    for (scan_id, mode, cutoff_iso, scanned_at, notable_count, candidates_scanned) in &inbox.scans {
        conn.execute(
            "INSERT OR REPLACE INTO inbox_scans
             (scan_id, mode, cutoff_iso, scanned_at, notable_count, candidates_scanned)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                scan_id,
                mode,
                cutoff_iso,
                scanned_at,
                notable_count,
                candidates_scanned,
            ),
        )?;
    }
    for row in &inbox.alerts {
        if !message_row_exists(conn, &row.message_id)? {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO inbox_alerts (message_id, surfaced_at, scan_id)
             VALUES (?1, ?2, ?3)",
            (&row.message_id, &row.surfaced_at, &row.scan_id),
        )?;
    }
    for row in &inbox.reviews {
        if !message_row_exists(conn, &row.message_id)? {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO inbox_reviews (message_id, surfaced_at, scan_id)
             VALUES (?1, ?2, ?3)",
            (&row.message_id, &row.surfaced_at, &row.scan_id),
        )?;
    }
    for row in &inbox.decisions {
        if !message_row_exists(conn, &row.message_id)? {
            continue;
        }
        let action = normalize_inbox_decision_action(row.action.as_str());
        conn.execute(
            "INSERT OR REPLACE INTO inbox_decisions
             (message_id, rules_fingerprint, action, matched_rule_ids, note, decision_source, decided_at,
              requires_user_action, action_summary)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            (
                &row.message_id,
                &row.rules_fingerprint,
                action,
                &row.matched_rule_ids,
                row.note.as_deref(),
                &row.decision_source,
                &row.decided_at,
                row.requires_user_action,
                row.action_summary.as_deref(),
            ),
        )?;
    }
    Ok(())
}

fn rebuild_temp_db_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(".rebuild");
    PathBuf::from(s)
}

fn maybe_rebuild_stale_db(path: &Path) -> Result<(), DbError> {
    let Some(version) = read_user_version(path)? else {
        return Ok(());
    };
    if version == SCHEMA_VERSION {
        return Ok(());
    }

    let maildir_root = crate::layout_migrate::infer_maildir_root_for_db_path(path);
    println!(
        "Detected schema drift (db version {version}, code version {SCHEMA_VERSION}). Rebuilding the local index from maildir cache now; this can take a while..."
    );
    let _ = std::io::stdout().flush();
    let stale_conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    apply_connection_pragmas(&stale_conn)?;
    let checkpoints = load_sync_checkpoints(&stale_conn)?;
    let summary = load_sync_summary_snapshot(&stale_conn)?;
    let inbox = load_inbox_state_snapshot(&stale_conn)?;
    drop(stale_conn);

    let temp_path = rebuild_temp_db_path(path);
    if temp_path.exists() {
        std::fs::remove_file(&temp_path)?;
    }
    let temp_wal_path = sqlite_sidecar_path(&temp_path, "-wal");
    if temp_wal_path.exists() {
        std::fs::remove_file(&temp_wal_path)?;
    }
    let temp_shm_path = sqlite_sidecar_path(&temp_path, "-shm");
    if temp_shm_path.exists() {
        std::fs::remove_file(&temp_shm_path)?;
    }

    let mut conn = open_file_current_schema(&temp_path)?;
    let _ = crate::rebuild_index::rebuild_from_maildir(&mut conn, &maildir_root)?;
    restore_sync_metadata(&conn, &checkpoints, &summary)?;
    restore_inbox_state(&conn, &inbox)?;
    let ripmail_home = path
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let cfg = crate::config::load_config(crate::config::LoadConfigOptions {
        home: Some(ripmail_home),
        env: None,
    });
    if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        match rt.block_on(crate::inbox::bootstrap::run_post_rebuild_inbox_bootstrap(
            &conn,
            &cfg,
            cfg.inbox_bootstrap_archive_older_than.as_str(),
            false,
        )) {
            Ok(s) => eprintln!(
                "Inbox bootstrap: bulk-archived {} older messages; classified {} candidates (deterministic rules)",
                s.bulk_archived_older_than_cutoff,
                s.inbox_candidates_classified
            ),
            Err(e) => eprintln!("Inbox bootstrap failed: {e}"),
        }
    }
    conn.execute_batch("PRAGMA wal_checkpoint(FULL); PRAGMA journal_mode=DELETE;")?;
    drop(conn);

    let backup_path = path.with_extension("db.pre-rebuild");
    let backup_wal_path = sqlite_sidecar_path(&backup_path, "-wal");
    let backup_shm_path = sqlite_sidecar_path(&backup_path, "-shm");
    if backup_path.exists() {
        std::fs::remove_file(&backup_path)?;
    }
    if backup_wal_path.exists() {
        std::fs::remove_file(&backup_wal_path)?;
    }
    if backup_shm_path.exists() {
        std::fs::remove_file(&backup_shm_path)?;
    }
    if path.exists() {
        std::fs::rename(path, &backup_path)?;
    }
    let wal_path = sqlite_sidecar_path(path, "-wal");
    if wal_path.exists() {
        let _ = std::fs::rename(&wal_path, &backup_wal_path);
    }
    let shm_path = sqlite_sidecar_path(path, "-shm");
    if shm_path.exists() {
        let _ = std::fs::rename(&shm_path, &backup_shm_path);
    }
    std::fs::rename(&temp_path, path)?;
    if backup_path.exists() {
        let _ = std::fs::remove_file(&backup_path);
    }
    if backup_wal_path.exists() {
        let _ = std::fs::remove_file(&backup_wal_path);
    }
    if backup_shm_path.exists() {
        let _ = std::fs::remove_file(&backup_shm_path);
    }
    Ok(())
}

fn sqlite_sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

fn open_file_current_schema(path: &Path) -> Result<Connection, DbError> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    apply_connection_pragmas(&conn)?;
    apply_schema(&conn)?;
    Ok(conn)
}

fn apply_readonly_connection_pragmas(conn: &Connection) -> Result<(), DbError> {
    conn.busy_timeout(Duration::from_secs(60))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA query_only = ON;",
    )?;
    Ok(())
}

/// Open the index **read-only** (no schema migration, no journal-mode writes). Use for search/read
/// and other query-only paths when the file already exists.
pub fn open_file_readonly(path: &Path) -> Result<Connection, DbError> {
    if !path.exists() {
        return Err(DbError::InvalidInput(format!(
            "database file does not exist: {}",
            path.display()
        )));
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    apply_readonly_connection_pragmas(&conn)?;
    Ok(conn)
}

/// Prefer a read-only connection when `path` exists; otherwise create via [`open_file`] (writable).
pub fn open_file_for_queries(path: &Path) -> Result<Connection, DbError> {
    if path.exists() {
        open_file_readonly(path)
    } else {
        open_file(path)
    }
}

/// Open an in-memory database with full schema (for tests).
pub fn open_memory() -> Result<Connection, DbError> {
    let conn = Connection::open_in_memory()?;
    apply_connection_pragmas(&conn)?;
    apply_schema(&conn)?;
    Ok(conn)
}

fn open_file_inner(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    maybe_rebuild_stale_db(path)?;
    open_file_current_schema(path)
}

/// Open file-backed DB at `path`, creating parent dirs. Applies schema + bootstrap like TS `getDb`.
///
/// Retries up to **3 attempts** with **1 second** between attempts when SQLite returns busy or locked
/// during open/rebuild/schema setup.
pub fn open_file(path: &Path) -> Result<Connection, DbError> {
    retry_on_busy(|| open_file_inner(path))
}

/// A write connection shared across parallel sync threads via a mutex.
///
/// WAL mode means readers never block writers and vice-versa. Concurrent writers queue on the
/// mutex; since writes are a tiny fraction of wall-clock time (the rest is network I/O), contention
/// is negligible in practice.
pub type SharedConn = std::sync::Arc<std::sync::Mutex<Connection>>;

/// Open a writable connection and wrap it for shared use across sync threads.
pub fn open_shared(path: &Path) -> Result<SharedConn, DbError> {
    let conn = open_file(path)?;
    Ok(std::sync::Arc::new(std::sync::Mutex::new(conn)))
}

/// Old `sync_summary` allowed only `id = 1`. Rebuild so `id = 2` can hold the backfill lock lane.
fn migrate_sync_summary_allow_id_2(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(
        r#"
        CREATE TABLE sync_summary_v26 (
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
        INSERT INTO sync_summary_v26 SELECT * FROM sync_summary WHERE id = 1;
        INSERT OR IGNORE INTO sync_summary_v26 (id, total_messages) VALUES (2, 0);
        DROP TABLE sync_summary;
        ALTER TABLE sync_summary_v26 RENAME TO sync_summary;
        "#,
    )?;
    Ok(())
}

/// Ensure row `id=2` exists for the backfill lock (no-op when already present).
fn ensure_sync_summary_row_2(conn: &Connection) -> Result<(), DbError> {
    match conn.execute(
        "INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (2, 0)",
        [],
    ) {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("CHECK") || msg.contains("constraint") {
                migrate_sync_summary_allow_id_2(conn)?;
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (2, 0)",
                    [],
                );
                Ok(())
            } else {
                Err(e.into())
            }
        }
    }
}

/// Apply schema + user_version + sync_summary bootstrap + optional ALTER (matches TS `getDb`).
pub fn apply_schema(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(SCHEMA)?;
    let _ = conn.execute_batch(
        "DROP INDEX IF EXISTS idx_inbox_handled_message;
         DROP TABLE IF EXISTS inbox_handled;",
    );
    conn.execute_batch("INSERT OR IGNORE INTO sync_summary (id, total_messages) VALUES (1, 0);")?;
    ensure_sync_summary_row_2(conn)?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;

    let mut stmt = conn.prepare("PRAGMA table_info(sync_summary)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cols.iter().any(|c| c == "sync_lock_started_at") {
        conn.execute_batch("ALTER TABLE sync_summary ADD COLUMN sync_lock_started_at TEXT;")?;
    }

    let mut msg_stmt = conn.prepare("PRAGMA table_info(messages)")?;
    let msg_cols: Vec<String> = msg_stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !msg_cols.iter().any(|c| c == "is_archived") {
        conn.execute_batch(
            "ALTER TABLE messages ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    if !msg_cols.iter().any(|c| c == "category") {
        conn.execute_batch("ALTER TABLE messages ADD COLUMN category TEXT;")?;
    }

    Ok(())
}

/// Returns `journal_mode` pragma value (e.g. "wal").
pub fn journal_mode(conn: &Connection) -> Result<String, DbError> {
    let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
    Ok(mode.to_lowercase())
}

/// List user tables (excludes sqlite internal + FTS shadow tables).
pub fn list_user_tables(conn: &Connection) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

/// Remove all indexed rows for one mailbox (messages, FTS via triggers, attachments, inbox refs,
/// sync checkpoints). Use when deleting a mailbox from config so search/read do not reference
/// removed maildir files.
pub fn purge_mailbox_from_index(conn: &mut Connection, mailbox_id: &str) -> Result<u64, DbError> {
    let mailbox_id = mailbox_id.trim();
    if mailbox_id.is_empty() {
        return Err(DbError::InvalidInput(
            "mailbox_id must not be empty".to_string(),
        ));
    }

    let n: u64 = conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE source_id = ?1",
        [mailbox_id],
        |r| Ok(r.get::<_, i64>(0)? as u64),
    )?;

    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM attachments WHERE message_id IN (SELECT message_id FROM messages WHERE source_id = ?1)",
        [mailbox_id],
    )?;
    tx.execute(
        "DELETE FROM inbox_alerts WHERE message_id IN (SELECT message_id FROM messages WHERE source_id = ?1)",
        [mailbox_id],
    )?;
    tx.execute(
        "DELETE FROM inbox_reviews WHERE message_id IN (SELECT message_id FROM messages WHERE source_id = ?1)",
        [mailbox_id],
    )?;
    tx.execute(
        "DELETE FROM inbox_decisions WHERE message_id IN (SELECT message_id FROM messages WHERE source_id = ?1)",
        [mailbox_id],
    )?;
    tx.execute("DELETE FROM messages WHERE source_id = ?1", [mailbox_id])?;
    tx.execute(
        "DELETE FROM document_index WHERE source_id = ?1 AND kind = 'file'",
        [mailbox_id],
    )?;
    tx.execute("DELETE FROM files WHERE source_id = ?1", [mailbox_id])?;
    tx.execute(
        "DELETE FROM threads WHERE thread_id NOT IN (SELECT DISTINCT thread_id FROM messages)",
        [],
    )?;
    tx.execute("DELETE FROM sync_state WHERE source_id = ?1", [mailbox_id])?;
    tx.execute(
        "DELETE FROM sync_windows WHERE source_id = ?1",
        [mailbox_id],
    )?;
    tx.execute(
        "DELETE FROM source_sync_meta WHERE source_id = ?1",
        [mailbox_id],
    )?;
    tx.commit()?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_memory_user_version() {
        let conn = open_memory().unwrap();
        let v: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
    }

    #[test]
    fn journal_mode_sensible() {
        let conn = open_memory().unwrap();
        let mode = journal_mode(&conn).unwrap();
        // In-memory DBs often report `memory`; file-backed uses WAL after pragma.
        assert!(
            mode == "wal" || mode == "memory",
            "unexpected journal_mode={mode}"
        );
    }

    #[test]
    fn open_file_readonly_errors_when_missing() {
        let p = PathBuf::from("/nonexistent/ripmail-no-such-file.db");
        let e = open_file_readonly(&p).unwrap_err();
        match e {
            DbError::InvalidInput(msg) => assert!(msg.contains("does not exist")),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn open_file_for_queries_creates_then_readonly_open() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("ripmail.db");
        assert!(!db_path.exists());
        let _ = open_file_for_queries(&db_path).unwrap();
        assert!(db_path.exists());
        let conn = open_file_for_queries(&db_path).unwrap();
        let v: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
    }

    #[test]
    fn retry_on_busy_succeeds_on_second_attempt() {
        let mut calls = 0;
        let r = retry_on_busy(|| {
            calls += 1;
            if calls == 1 {
                Err(DbError::Sqlite(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
                    None,
                )))
            } else {
                Ok(7u8)
            }
        });
        assert_eq!(r.unwrap(), 7);
        assert_eq!(calls, 2);
    }

    #[test]
    fn core_tables_exist() {
        let conn = open_memory().unwrap();
        let tables = list_user_tables(&conn).unwrap();
        assert!(tables.iter().any(|n| n == "messages"));
        assert!(tables.iter().any(|n| n == "document_index_fts"));
    }

    #[test]
    fn purge_mailbox_from_index_removes_messages_and_keeps_other_mailbox() {
        let mut conn = open_memory().unwrap();
        conn.execute(
            "INSERT INTO messages (message_id, thread_id, folder, uid, from_address, to_addresses, cc_addresses, subject, body_text, date, raw_path, source_id)
             VALUES ('<a@x>', '<a@x>', 'f', 1, 'a@b', '[]', '[]', 's', 'b', '2020-01-01T00:00:00Z', 'maildir/cur/a.eml', 'mb_a')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (message_id, thread_id, folder, uid, from_address, to_addresses, cc_addresses, subject, body_text, date, raw_path, source_id)
             VALUES ('<b@x>', '<b@x>', 'f', 1, 'a@b', '[]', '[]', 's', 'b', '2020-01-01T00:00:00Z', 'maildir/cur/b.eml', 'mb_b')",
            [],
        )
        .unwrap();
        let n = purge_mailbox_from_index(&mut conn, "mb_a").unwrap();
        assert_eq!(n, 1);
        let left: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE source_id = 'mb_b'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(left, 1);
        let gone: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE source_id = 'mb_a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gone, 0);
    }

    /// Rebuild path restores `inbox_decisions` including `requires_user_action` / `action_summary`.
    #[test]
    fn inbox_snapshot_roundtrips_action_required_columns() {
        use crate::persist_message;
        use crate::sync::ParsedMessage;

        let conn = open_memory().unwrap();
        apply_schema(&conn).unwrap();
        let mut parsed = ParsedMessage {
            message_id: "<snap-action@test>".into(),
            from_address: "a@b.com".into(),
            from_name: None,
            to_addresses: vec![],
            cc_addresses: vec![],
            to_recipients: vec![],
            cc_recipients: vec![],
            subject: "s".into(),
            date: "2026-01-01T12:00:00Z".into(),
            body_text: "b".into(),
            body_html: None,
            attachments: vec![],
            category: None,
            ..Default::default()
        };
        persist_message(&conn, &mut parsed, "INBOX", "test_mb", 1, "[]", "x.eml").unwrap();
        conn.execute(
            "INSERT INTO inbox_decisions
             (message_id, rules_fingerprint, action, matched_rule_ids, note, decision_source, requires_user_action, action_summary)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                "<snap-action@test>",
                "fp-snap",
                "inform",
                "[]",
                None::<String>,
                "model",
                1i64,
                "Pay invoice",
            ],
        )
        .unwrap();

        let snap = load_inbox_state_snapshot(&conn).unwrap();
        assert_eq!(snap.decisions.len(), 1);
        assert_eq!(snap.decisions[0].requires_user_action, 1);
        assert_eq!(
            snap.decisions[0].action_summary.as_deref(),
            Some("Pay invoice")
        );

        conn.execute("DELETE FROM inbox_decisions", []).unwrap();
        restore_inbox_state(&conn, &snap).unwrap();

        let (rua, summ): (i64, Option<String>) = conn
            .query_row(
                "SELECT requires_user_action, action_summary FROM inbox_decisions WHERE message_id = '<snap-action@test>'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(rua, 1);
        assert_eq!(summ.as_deref(), Some("Pay invoice"));
    }

    /// Post-rebuild maildir may import no `.eml`; inbox snapshot still references old `message_id`s.
    /// Restore must skip those rows so `FOREIGN KEY` on inbox_* → messages does not fail.
    #[test]
    fn restore_inbox_state_skips_rows_when_message_not_in_messages() {
        let conn = open_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO inbox_scans (scan_id, mode, cutoff_iso, scanned_at, notable_count, candidates_scanned)
             VALUES ('scan-1', 'full', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 0, 0)",
            [],
        )
        .unwrap();
        let inbox = InboxStateSnapshot {
            scans: vec![(
                "scan-1".into(),
                "full".into(),
                "2026-01-01T00:00:00Z".into(),
                "2026-01-02T00:00:00Z".into(),
                0,
                0,
            )],
            alerts: vec![InboxSurfacedRow {
                message_id: "<gone@mid>".into(),
                surfaced_at: "2026-01-03T00:00:00Z".into(),
                scan_id: "scan-1".into(),
            }],
            reviews: vec![InboxSurfacedRow {
                message_id: "<gone@mid>".into(),
                surfaced_at: "2026-01-03T00:00:00Z".into(),
                scan_id: "scan-1".into(),
            }],
            decisions: vec![InboxDecisionRow {
                message_id: "<gone@mid>".into(),
                rules_fingerprint: "fp".into(),
                action: "ignore".into(),
                matched_rule_ids: "[]".into(),
                note: None,
                decision_source: "test".into(),
                decided_at: "2026-01-03T00:00:00Z".into(),
                requires_user_action: 0,
                action_summary: None,
            }],
        };
        restore_inbox_state(&conn, &inbox).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbox_alerts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbox_reviews", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbox_decisions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM inbox_scans WHERE scan_id = 'scan-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn inbox_decisions_has_action_columns_requires_both_names() {
        let conn = open_memory().unwrap();
        assert!(
            inbox_decisions_has_action_columns(&conn).unwrap(),
            "current schema should expose both action columns"
        );

        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             ALTER TABLE inbox_decisions DROP COLUMN action_summary;
             PRAGMA foreign_keys=ON;",
        )
        .unwrap();
        assert!(
            !inbox_decisions_has_action_columns(&conn).unwrap(),
            "partial column set must use legacy snapshot SELECT (v16-style drift)"
        );
    }

    /// Stale DBs (e.g. user_version 16) may have `inbox_decisions` without action columns; drift rebuild must still snapshot.
    #[test]
    fn inbox_snapshot_loads_legacy_decisions_without_action_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE inbox_scans (
                scan_id TEXT PRIMARY KEY,
                mode TEXT NOT NULL,
                cutoff_iso TEXT NOT NULL,
                scanned_at TEXT NOT NULL,
                notable_count INTEGER NOT NULL DEFAULT 0,
                candidates_scanned INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE inbox_decisions (
                message_id TEXT NOT NULL,
                rules_fingerprint TEXT NOT NULL,
                action TEXT NOT NULL,
                matched_rule_ids TEXT NOT NULL DEFAULT '[]',
                note TEXT,
                decision_source TEXT NOT NULL,
                decided_at TEXT NOT NULL,
                PRIMARY KEY (message_id, rules_fingerprint)
            );
            INSERT INTO inbox_scans VALUES ('s1', 'check', '2026-01-01', '2026-01-02', 0, 0);
            INSERT INTO inbox_decisions VALUES ('<legacy@test>', 'fp', 'inform', '[]', NULL, 'model', '2026-01-03');",
        )
        .unwrap();

        let snap = load_inbox_state_snapshot(&conn).unwrap();
        assert_eq!(snap.decisions.len(), 1);
        assert_eq!(snap.decisions[0].message_id, "<legacy@test>");
        assert_eq!(snap.decisions[0].requires_user_action, 0);
        assert!(snap.decisions[0].action_summary.is_none());
    }

    /// Regression: v16 (or any DB whose `inbox_decisions` lacks `requires_user_action` /
    /// `action_summary`) must snapshot successfully during schema drift. Previously
    /// `load_inbox_state_snapshot` always selected those columns and failed with
    /// "no such column", blocking `open_file` / `rebuild-index` upgrades.
    #[test]
    fn open_file_drift_rebuild_succeeds_with_legacy_inbox_decisions_table() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join("data");
        let maildir = data_dir.join("maildir/cur");
        std::fs::create_dir_all(&maildir).unwrap();
        std::fs::write(
            maildir.join("msg1.eml"),
            b"From: a@b.com\r\nSubject: Legacy drift\r\nMessage-ID: <legacy-drift@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nBody",
        )
        .unwrap();

        let db_path = data_dir.join("ripmail.db");
        let stale = Connection::open(&db_path).unwrap();
        apply_connection_pragmas(&stale).unwrap();
        apply_schema(&stale).unwrap();

        stale
            .execute_batch(
                "INSERT INTO messages (message_id, thread_id, folder, uid, labels, category, from_address, from_name, to_addresses, cc_addresses, subject, date, body_text, raw_path, source_id, is_archived)
                 VALUES ('<legacy-drift@test>', 't1', 'INBOX', 1, '[]', NULL, 'a@b.com', NULL, '[]', '[]', 'Legacy drift', '2024-01-01T12:00:00.000Z', 'Body', 'cur/msg1.eml', '', 0);
                 INSERT INTO inbox_scans (scan_id, mode, cutoff_iso, scanned_at, notable_count, candidates_scanned)
                 VALUES ('legacy-scan', 'check', '2024-01-01T00:00:00Z', '2026-04-01 18:00:00', 0, 1);",
            )
            .unwrap();

        stale
            .execute_batch(
                "PRAGMA foreign_keys=OFF;
                 ALTER TABLE inbox_decisions DROP COLUMN requires_user_action;
                 ALTER TABLE inbox_decisions DROP COLUMN action_summary;
                 PRAGMA foreign_keys=ON;",
            )
            .unwrap();

        stale
            .execute(
                "INSERT INTO inbox_decisions
                 (message_id, rules_fingerprint, action, matched_rule_ids, note, decision_source, decided_at)
                 VALUES ('<legacy-drift@test>', 'fp-legacy', 'inform', '[]', NULL, 'model', '2026-04-01 18:00:00')",
                [],
            )
            .unwrap();

        stale
            .pragma_update(None, "user_version", SCHEMA_VERSION - 1)
            .unwrap();
        drop(stale);

        let conn = open_file(&db_path).unwrap();
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE message_id = '<legacy-drift@test>'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn open_file_rebuilds_when_user_version_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join("data");
        let maildir = data_dir.join("maildir/cur");
        std::fs::create_dir_all(&maildir).unwrap();
        std::fs::write(
            maildir.join("msg1.eml"),
            b"From: a@b.com\r\nSubject: Hi\r\nMessage-ID: <rebuilt@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nBody",
        )
        .unwrap();

        let db_path = data_dir.join("ripmail.db");
        let stale = Connection::open(&db_path).unwrap();
        stale
            .execute_batch("CREATE TABLE stale_only (id INTEGER PRIMARY KEY);")
            .unwrap();
        stale
            .pragma_update(None, "user_version", SCHEMA_VERSION - 1)
            .unwrap();
        drop(stale);

        let conn = open_file(&db_path).unwrap();
        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn open_file_rebuild_preserves_sync_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join("data");
        let maildir = data_dir.join("maildir/cur");
        std::fs::create_dir_all(&maildir).unwrap();
        std::fs::write(
            maildir.join("msg1.eml"),
            b"From: a@b.com\r\nSubject: Hi\r\nMessage-ID: <rebuilt-sync@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nBody",
        )
        .unwrap();

        let db_path = data_dir.join("ripmail.db");
        let stale = Connection::open(&db_path).unwrap();
        apply_connection_pragmas(&stale).unwrap();
        apply_schema(&stale).unwrap();
        stale
            .execute(
                "INSERT OR REPLACE INTO sync_state (source_id, folder, uidvalidity, last_uid) VALUES ('', 'INBOX', 7, 42)",
                [],
            )
            .unwrap();
        stale
            .execute(
                "UPDATE sync_summary SET target_start_date = '2024-01-01', sync_start_earliest_date = '2025-01-01', last_sync_at = '2026-04-01 18:00:00'",
                [],
            )
            .unwrap();
        stale
            .pragma_update(None, "user_version", SCHEMA_VERSION - 1)
            .unwrap();
        drop(stale);

        let conn = open_file(&db_path).unwrap();
        let state: (i64, i64) = conn
            .query_row(
                "SELECT uidvalidity, last_uid FROM sync_state WHERE source_id = '' AND folder = 'INBOX'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, (7, 42));
        let summary: (Option<String>, Option<String>, i64, Option<String>) = conn
            .query_row(
                "SELECT target_start_date, sync_start_earliest_date, total_messages, last_sync_at FROM sync_summary WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(summary.0.as_deref(), Some("2024-01-01"));
        assert_eq!(summary.1.as_deref(), Some("2025-01-01"));
        assert_eq!(summary.2, 1);
        assert_eq!(summary.3.as_deref(), Some("2026-04-01 18:00:00"));
    }

    #[test]
    fn open_file_rebuild_clears_inbox_tables_and_bulk_archives_old_mail() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join("data");
        let maildir = data_dir.join("maildir/cur");
        std::fs::create_dir_all(&maildir).unwrap();
        std::fs::write(
            maildir.join("msg1.eml"),
            b"From: a@b.com\r\nSubject: Hi\r\nMessage-ID: <rebuilt-inbox@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nBody",
        )
        .unwrap();

        let db_path = data_dir.join("ripmail.db");
        let stale = Connection::open(&db_path).unwrap();
        apply_connection_pragmas(&stale).unwrap();
        apply_schema(&stale).unwrap();
        stale
            .execute(
                "INSERT INTO messages (message_id, thread_id, folder, uid, labels, category, from_address, from_name, to_addresses, cc_addresses, subject, date, body_text, raw_path, source_id, is_archived)
                 VALUES (?1, ?2, ?3, ?4, '[]', NULL, ?5, NULL, '[]', '[]', ?6, ?7, ?8, ?9, '', 0)",
                (
                    "<rebuilt-inbox@test>",
                    "thread-1",
                    "INBOX",
                    1i64,
                    "a@b.com",
                    "Hi",
                    "2024-01-01T12:00:00.000Z",
                    "Body",
                    "cur/msg1.eml",
                ),
            )
            .unwrap();
        stale
            .execute(
                "INSERT INTO inbox_scans (scan_id, mode, cutoff_iso, scanned_at, notable_count, candidates_scanned)
                 VALUES ('scan-1', 'check', '2024-01-01T00:00:00Z', '2026-04-01 18:00:00', 1, 1)",
                [],
            )
            .unwrap();
        stale
            .execute(
                "INSERT INTO inbox_alerts (message_id, surfaced_at, scan_id)
                 VALUES ('<rebuilt-inbox@test>', '2026-04-01 18:00:00', 'scan-1')",
                [],
            )
            .unwrap();
        stale
            .execute(
                "INSERT INTO inbox_decisions
                 (message_id, rules_fingerprint, action, matched_rule_ids, note, decision_source, decided_at)
                 VALUES ('<rebuilt-inbox@test>', 'fp-1', 'ignore', '[\"r1\"]', 'cached note', 'rule', '2026-04-01 18:30:00')",
                [],
            )
            .unwrap();
        stale
            .pragma_update(None, "user_version", SCHEMA_VERSION - 1)
            .unwrap();
        drop(stale);

        let conn = open_file(&db_path).unwrap();
        let scan_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbox_scans", [], |row| row.get(0))
            .unwrap();
        let alert_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbox_alerts", [], |row| row.get(0))
            .unwrap();
        let decision_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbox_decisions", [], |row| row.get(0))
            .unwrap();
        let archived: i64 = conn
            .query_row(
                "SELECT is_archived FROM messages WHERE message_id = '<rebuilt-inbox@test>'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Inbox bootstrap records a scan and repopulates decisions for classified candidates.
        assert_eq!(scan_count, 1);
        assert_eq!(alert_count, 0);
        assert_eq!(decision_count, 1);
        // Bulk archive may mark old mail archived first; deterministic inbox then sets
        // `is_archived = 0` for notify/inform (this fixture classifies as non-ignore).
        assert_eq!(archived, 0);
    }

    #[test]
    fn open_file_rebuild_succeeds_while_old_reader_is_open() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join("data");
        let maildir = data_dir.join("maildir/cur");
        std::fs::create_dir_all(&maildir).unwrap();
        std::fs::write(
            maildir.join("msg1.eml"),
            b"From: a@b.com\r\nSubject: Hi\r\nMessage-ID: <reader@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nBody",
        )
        .unwrap();

        let db_path = data_dir.join("ripmail.db");
        let stale = Connection::open(&db_path).unwrap();
        apply_connection_pragmas(&stale).unwrap();
        apply_schema(&stale).unwrap();
        stale
            .pragma_update(None, "user_version", SCHEMA_VERSION - 1)
            .unwrap();

        let reader = Connection::open(&db_path).unwrap();
        let _: i64 = reader
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap();

        let conn = open_file(&db_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(reader);
    }
}
