//! Read-only access to Apple Mail `MailData/Envelope Index` (schema varies by macOS version).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

/// Effective timestamp for envelope pagination and `--since` filtering.
///
/// Apple Mail often leaves **`date_received` NULL** on **Sent** (and some outbound) rows while
/// **`date_sent` is set**. Using only `date_received` in `WHERE … >= ?` excluded those rows from
/// sync entirely (SQL NULL comparisons), so ripmail under-indexed outbound mail.
const ENVELOPE_EFFECTIVE_TS_SQL: &str = "COALESCE(NULLIF(date_received, 0), date_sent)";

/// Lightweight row for Apple Mail sync (no per-column `HashMap`).
#[derive(Debug, Clone)]
pub struct EnvelopeCandidate {
    pub rowid: i64,
    /// `messages.mailbox` → `mailboxes.ROWID`.
    pub mailbox: i64,
    /// Effective Unix seconds for sort/filter: `COALESCE(NULLIF(date_received,0), date_sent)`.
    pub date_received: i64,
    pub deleted: i32,
    pub flags: i64,
    /// `messages.remote_id` when the Envelope Index has that column (often IMAP UID). On-disk
    /// `*.emlx` stems may match `remote_id` when they differ from SQLite `ROWID`.
    pub remote_id: Option<i64>,
}

/// One row from `messages` with columns we could interpret (best-effort).
#[derive(Debug, Clone)]
pub struct EnvelopeMessageRow {
    pub rowid: i64,
    /// `messages.mailbox` → `mailboxes.ROWID` when present.
    pub mailbox_rowid: Option<i64>,
    /// `messages.remote_id` — on-disk `.emlx` stem under that mailbox (`{remote_id}.emlx`), **not** necessarily `ROWID`.
    pub remote_id: Option<i64>,
    /// Raw `messages.date_received` (INTEGER/REAL) — preferred for `--since` (avoids stringify loss).
    pub date_received: Option<f64>,
    /// Raw `messages.date_sent` (INTEGER/REAL).
    pub date_sent: Option<f64>,
    pub columns: HashMap<String, String>,
}

impl EnvelopeMessageRow {
    /// Primary filename stem for `…/Messages/{stem}.emlx` (per-mailbox).
    ///
    /// Resolution tries **SQLite `ROWID` first**, then **`remote_id`** when present and distinct
    /// (see [`super::paths::resolve_emlx_deterministic_then_scan`]). Some accounts name files by
    /// IMAP UID (`remote_id`); others match `ROWID`.
    #[must_use]
    pub fn emlx_file_stem_id(&self) -> i64 {
        self.rowid
    }
}

/// Discover `~/Library/Mail/V*` directories (highest version suffix first if sortable).
pub fn discover_mail_library_roots(home: &Path) -> Vec<PathBuf> {
    let mail = home.join("Library").join("Mail");
    let Ok(entries) = std::fs::read_dir(&mail) else {
        return Vec::new();
    };
    let mut roots: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('V') && p.join("MailData").is_dir())
                .unwrap_or(false)
        })
        .collect();
    roots.sort_by(|a, b| b.cmp(a));
    roots
}

/// Default: first [`discover_mail_library_roots`] hit, else `None`.
pub fn default_mail_library_root(home: &Path) -> Option<PathBuf> {
    discover_mail_library_roots(home).into_iter().next()
}

/// Path to the SQLite envelope index inside a mail version root (e.g. `.../V10`).
pub fn envelope_index_path(mail_version_root: &Path) -> PathBuf {
    mail_version_root.join("MailData").join("Envelope Index")
}

/// Open Apple’s envelope DB read-only (no writes; avoid WAL side effects).
pub fn open_envelope_readonly(path: &Path) -> rusqlite::Result<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    conn.execute_batch("PRAGMA query_only = ON;")?;
    Ok(conn)
}

/// Row count in `messages` (denominator for progress; can be slow on huge DBs but usually acceptable).
pub fn messages_table_row_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
}

/// Dump `sqlite_master` DDL for debugging / `applemail-explore schema`.
pub fn schema_dump(conn: &Connection) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut out = String::new();
    for row in rows {
        let (t, n, sql) = row?;
        out.push_str(&format!("{t} {n}\n"));
        if let Some(s) = sql {
            out.push_str(&s);
            out.push('\n');
        }
        out.push('\n');
    }
    Ok(out)
}

fn sqlite_value_to_f64(v: &rusqlite::types::Value) -> Option<f64> {
    use rusqlite::types::Value;
    match v {
        Value::Integer(i) => Some(*i as f64),
        Value::Real(f) => Some(*f),
        Value::Text(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn stringify_sql_value(v: &rusqlite::types::Value) -> String {
    use rusqlite::types::Value;
    match v {
        Value::Null => String::new(),
        Value::Integer(i) => i.to_string(),
        Value::Real(f) => f.to_string(),
        Value::Text(s) => s.clone(),
        Value::Blob(b) => format!("<{} bytes>", b.len()),
    }
}

/// Sample recent rows from `messages` with dynamic columns (macOS-version tolerant).
pub fn sample_messages(
    conn: &Connection,
    limit: usize,
) -> rusqlite::Result<Vec<EnvelopeMessageRow>> {
    sample_messages_page(conn, limit, 0)
}

/// Paged slice: `ORDER BY ROWID DESC` with `LIMIT` / `OFFSET` (highest ROWID first).
pub fn sample_messages_page(
    conn: &Connection,
    limit: usize,
    offset: usize,
) -> rusqlite::Result<Vec<EnvelopeMessageRow>> {
    sample_messages_page_since(conn, limit, offset, None)
}

/// Paged slice with optional `--since` filter pushed to SQL WHERE clause.
///
/// When `since_unix_ts` is provided, only returns rows where the effective envelope timestamp
/// ([`ENVELOPE_EFFECTIVE_TS_SQL`]) is `>= ts`. Uses the same expression in `ORDER BY … DESC`.
/// This dramatically reduces rows fetched for narrow time windows (e.g., 253k → 40k for 1y).
pub fn sample_messages_page_since(
    conn: &Connection,
    limit: usize,
    offset: usize,
    since_unix_ts: Option<i64>,
) -> rusqlite::Result<Vec<EnvelopeMessageRow>> {
    let sql_tail = if since_unix_ts.is_some() {
        Some(format!(
            "SELECT ROWID AS _ripmail_rowid, * FROM messages \
             WHERE {ENVELOPE_EFFECTIVE_TS_SQL} >= ?3 \
             ORDER BY {ENVELOPE_EFFECTIVE_TS_SQL} DESC LIMIT ?1 OFFSET ?2"
        ))
    } else {
        None
    };
    let sql: &str = sql_tail.as_deref().unwrap_or(
        "SELECT ROWID AS _ripmail_rowid, * FROM messages ORDER BY ROWID DESC LIMIT ?1 OFFSET ?2",
    );
    let mut stmt = conn.prepare(sql)?;
    let col_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    let mailbox_idx = col_names
        .iter()
        .position(|n| n.eq_ignore_ascii_case("mailbox"));
    let mut rows_out = Vec::new();
    let lim = i64::try_from(limit).unwrap_or(i64::MAX);
    let off = i64::try_from(offset).unwrap_or(i64::MAX);
    let mut rows = if let Some(ts) = since_unix_ts {
        stmt.query(rusqlite::params![lim, off, ts])?
    } else {
        stmt.query(rusqlite::params![lim, off])?
    };
    while let Some(row) = rows.next()? {
        let rowid: i64 = row.get(0)?;
        let mut cols = HashMap::new();
        let mut mailbox_rowid = None;
        let mut remote_id = None;
        let mut date_received = None;
        let mut date_sent = None;
        for (i, name) in col_names.iter().enumerate() {
            if name == "_ripmail_rowid" {
                continue;
            }
            let v: rusqlite::types::Value = row.get(i)?;
            if Some(i) == mailbox_idx {
                if let rusqlite::types::Value::Integer(x) = v {
                    mailbox_rowid = Some(x);
                }
            }
            if name.eq_ignore_ascii_case("remote_id") {
                if let rusqlite::types::Value::Integer(x) = v {
                    remote_id = Some(x);
                }
            }
            if name.eq_ignore_ascii_case("date_received") {
                date_received = sqlite_value_to_f64(&v);
            } else if name.eq_ignore_ascii_case("date_sent") {
                date_sent = sqlite_value_to_f64(&v);
            }
            cols.insert(name.clone(), stringify_sql_value(&v));
        }
        rows_out.push(EnvelopeMessageRow {
            rowid,
            mailbox_rowid,
            remote_id,
            date_received,
            date_sent,
            columns: cols,
        });
    }
    Ok(rows_out)
}

/// `true` if Envelope Index `messages` has a `remote_id` column (Apple Mail V10+).
pub fn messages_table_has_remote_id(conn: &Connection) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(messages)")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name.eq_ignore_ascii_case("remote_id") {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Keyset-paged slice: newest mail first (`ORDER BY date_received DESC, ROWID DESC`).
///
/// Apple’s `ROWID` order does not match recency; paging by ROWID made the first thousands of
/// candidates often old mail while the UI waited for a high indexed count. We walk **recent-first**
/// so `.emlx` reads and FTS rows align with what users expect (like Mail’s inbox).
///
/// - `after`: `None` for the first page. Otherwise `(date_received, rowid)` from the **last** row of
///   the previous page; the next page returns rows strictly **older** in `(date_received, rowid)`
///   sort order (still respecting `--since`).
///
/// - `include_remote_id`: when [`messages_table_has_remote_id`] is true, pass `true` so each
///   candidate carries `remote_id` for `.emlx` stem resolution (often IMAP UID vs `ROWID`).
pub fn list_candidates_since_keyset(
    conn: &Connection,
    limit: usize,
    since_unix_ts: i64,
    after: Option<(i64, i64)>,
    include_remote_id: bool,
) -> rusqlite::Result<Vec<EnvelopeCandidate>> {
    let lim = i64::try_from(limit).unwrap_or(i64::MAX);
    let sel = if include_remote_id {
        format!(
            "SELECT ROWID, mailbox, {ENVELOPE_EFFECTIVE_TS_SQL} AS date_received, deleted, flags, remote_id"
        )
    } else {
        format!(
            "SELECT ROWID, mailbox, {ENVELOPE_EFFECTIVE_TS_SQL} AS date_received, deleted, flags"
        )
    };
    let sql = if after.is_none() {
        format!(
            "{sel} \
         FROM messages \
         WHERE {ENVELOPE_EFFECTIVE_TS_SQL} >= ?1 AND deleted = 0 \
         ORDER BY {ENVELOPE_EFFECTIVE_TS_SQL} DESC, ROWID DESC \
         LIMIT ?2"
        )
    } else {
        format!(
            "{sel} \
         FROM messages \
         WHERE {ENVELOPE_EFFECTIVE_TS_SQL} >= ?1 AND deleted = 0 \
         AND ({ENVELOPE_EFFECTIVE_TS_SQL} < ?3 OR ({ENVELOPE_EFFECTIVE_TS_SQL} = ?3 AND ROWID < ?4)) \
         ORDER BY {ENVELOPE_EFFECTIVE_TS_SQL} DESC, ROWID DESC \
         LIMIT ?2"
        )
    };
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = match after {
        None => stmt.query(rusqlite::params![since_unix_ts, lim])?,
        Some((cursor_date, cursor_rowid)) => stmt.query(rusqlite::params![
            since_unix_ts,
            lim,
            cursor_date,
            cursor_rowid
        ])?,
    };
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let rowid: i64 = row.get(0)?;
        let mailbox: i64 = row.get(1)?;
        let date_received: i64 = row.get(2)?;
        let deleted: i32 = row.get(3)?;
        let flags: i64 = row.get(4)?;
        let remote_id = if include_remote_id {
            row.get::<_, Option<i64>>(5)?
        } else {
            None
        };
        out.push(EnvelopeCandidate {
            rowid,
            mailbox,
            date_received,
            deleted,
            flags,
            remote_id,
        });
    }
    Ok(out)
}

/// `date_received` → `YYYY-MM-DD` (UTC) for [`EnvelopeCandidate`].
#[must_use]
pub fn envelope_candidate_received_date_ymd(c: &EnvelopeCandidate) -> Option<String> {
    apple_mail_time_to_ymd(c.date_received as f64)
}

/// Single row from `messages` by SQLite `ROWID` (for `applemail-explore read <rowid>`).
pub fn message_row_by_rowid(
    conn: &Connection,
    rowid: i64,
) -> rusqlite::Result<Option<EnvelopeMessageRow>> {
    let sql = "SELECT ROWID AS _ripmail_rowid, * FROM messages WHERE ROWID = ?1";
    let mut stmt = conn.prepare(sql)?;
    let col_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    let mailbox_idx = col_names
        .iter()
        .position(|n| n.eq_ignore_ascii_case("mailbox"));
    let mut rows = stmt.query(rusqlite::params![rowid])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let rid: i64 = row.get(0)?;
    let mut cols = HashMap::new();
    let mut mailbox_rowid = None;
    let mut remote_id = None;
    let mut date_received = None;
    let mut date_sent = None;
    for (i, name) in col_names.iter().enumerate() {
        if name == "_ripmail_rowid" {
            continue;
        }
        let v: rusqlite::types::Value = row.get(i)?;
        if Some(i) == mailbox_idx {
            if let rusqlite::types::Value::Integer(x) = v {
                mailbox_rowid = Some(x);
            }
        }
        if name.eq_ignore_ascii_case("remote_id") {
            if let rusqlite::types::Value::Integer(x) = v {
                remote_id = Some(x);
            }
        }
        if name.eq_ignore_ascii_case("date_received") {
            date_received = sqlite_value_to_f64(&v);
        } else if name.eq_ignore_ascii_case("date_sent") {
            date_sent = sqlite_value_to_f64(&v);
        }
        cols.insert(name.clone(), stringify_sql_value(&v));
    }
    Ok(Some(EnvelopeMessageRow {
        rowid: rid,
        mailbox_rowid,
        remote_id,
        date_received,
        date_sent,
        columns: cols,
    }))
}

/// Convert a raw timestamp from the Envelope Index to `YYYY-MM-DD` (UTC calendar day).
///
/// Modern Mail (`V10`+) stores **`date_received` / `date_sent` as Unix seconds** (≈ 1e9–1.7e9). Older
/// documentation uses **Cocoa** seconds since 2001-01-01 (smaller values). We treat
/// `raw ≥ 1_000_000_000` as Unix seconds (and `raw ≥ 1e12` as Unix milliseconds).
pub fn apple_mail_time_to_ymd(raw: f64) -> Option<String> {
    use chrono::{TimeZone, Utc};
    if raw >= 1e12 {
        let secs = (raw / 1000.0) as i64;
        return Utc
            .timestamp_opt(secs, 0)
            .single()
            .map(|dt| dt.format("%Y-%m-%d").to_string());
    }
    if raw >= 1_000_000_000.0 {
        return Utc
            .timestamp_opt(raw as i64, 0)
            .single()
            .map(|dt| dt.format("%Y-%m-%d").to_string());
    }
    cocoa_seconds_to_iso8601(raw).and_then(|s| s.get(0..10).map(str::to_string))
}

/// Best-effort: envelope `date_received` / `date_sent` → `YYYY-MM-DD` for `--since` (before reading `.emlx`).
pub fn envelope_received_date_ymd(row: &EnvelopeMessageRow) -> Option<String> {
    if let Some(dr) = row.date_received {
        return apple_mail_time_to_ymd(dr);
    }
    if let Some(ds) = row.date_sent {
        return apple_mail_time_to_ymd(ds);
    }
    const KEYS: &[&str] = &["date_received", "received_date", "date_sent", "sent_date"];
    for key in KEYS {
        let Some((_, v)) = row
            .columns
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
        else {
            continue;
        };
        if v.is_empty() || v.starts_with('<') {
            continue;
        }
        if let Ok(f) = v.parse::<f64>() {
            if let Some(ymd) = apple_mail_time_to_ymd(f) {
                return Some(ymd);
            }
        }
    }
    None
}

/// Apple Core Data reference date (seconds since 2001-01-01 00:00:00 UTC) → RFC3339-ish string used elsewhere in ripmail.
pub fn cocoa_seconds_to_iso8601(seconds: f64) -> Option<String> {
    use chrono::{TimeZone, Utc};
    const OFFSET: i64 = 978_307_200; // 2001-01-01 UTC as Unix secs
    let unix = OFFSET + seconds as i64;
    let dt = Utc.timestamp_opt(unix, 0).single()?;
    Some(dt.to_rfc3339())
}

/// Convert `YYYY-MM-DD` to Unix timestamp (start of day UTC) for SQL WHERE clause.
pub fn ymd_to_unix_ts(ymd: &str) -> Option<i64> {
    use chrono::NaiveDate;
    let date = NaiveDate::parse_from_str(ymd, "%Y-%m-%d").ok()?;
    Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp())
}

fn expand_tilde_path_simple(s: &str) -> PathBuf {
    if let Some(rest) = s.trim().strip_prefix("~/") {
        return dirs::home_dir()
            .map(|h| h.join(rest))
            .unwrap_or_else(|| PathBuf::from(s));
    }
    PathBuf::from(s.trim())
}

/// Ensure Apple Mail's Envelope Index exists (`ripmail setup --apple-mail`, wizard).
///
/// `apple_mail_path`: optional mail library root (`~/Library/Mail/V10`); `None` or empty = auto-detect
/// highest `V*` under `~/Library/Mail`.
///
/// Returns `Some(path)` to persist in config when the user gave an explicit root, or `None` when
/// auto-detection succeeded (omit `appleMailPath` in JSON).
pub fn validate_envelope_index_for_setup(
    apple_mail_path: Option<&str>,
) -> Result<Option<String>, String> {
    let user_home =
        dirs::home_dir().ok_or_else(|| "Could not resolve home directory.".to_string())?;

    let explicit = apple_mail_path.map(str::trim).filter(|s| !s.is_empty());

    let root = match explicit.as_ref() {
        Some(p) => expand_tilde_path_simple(p),
        None => default_mail_library_root(&user_home).ok_or_else(|| {
            format!(
                "Could not find Apple Mail under {}. Install Mail or grant Full Disk Access to this terminal app.",
                user_home.join("Library/Mail").display()
            )
        })?,
    };

    let index = envelope_index_path(&root);
    if !index.is_file() {
        return Err(format!(
            "Apple Mail Envelope Index not found at:\n  {}\n\nGrant Full Disk Access to this terminal app (Terminal, iTerm, Cursor, …): System Settings → Privacy & Security → Full Disk Access.",
            index.display()
        ));
    }

    Ok(explicit.map(|s| s.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn cocoa_seconds_roundtrip_sane() {
        let s = cocoa_seconds_to_iso8601(0.0).unwrap();
        assert!(s.starts_with("2001-01-01"));
    }

    #[test]
    fn sample_messages_reads_in_memory_db() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (mailbox INTEGER, subject TEXT);
             INSERT INTO messages VALUES (1, 'hi');",
        )
        .unwrap();
        let rows = sample_messages(&conn, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].mailbox_rowid, Some(1));
    }

    #[test]
    fn envelope_received_date_ymd_cocoa_seconds() {
        let row = EnvelopeMessageRow {
            rowid: 1,
            mailbox_rowid: None,
            remote_id: None,
            date_received: Some(0.0),
            date_sent: None,
            columns: HashMap::new(),
        };
        assert_eq!(
            envelope_received_date_ymd(&row).as_deref(),
            Some("2001-01-01")
        );
    }

    #[test]
    fn envelope_received_date_ymd_unix_seconds_modern_mail() {
        // 2026-04-15 11:08:42 UTC (from real V10 Envelope Index)
        let row = EnvelopeMessageRow {
            rowid: 253124,
            mailbox_rowid: None,
            remote_id: None,
            date_received: Some(1_776_251_322.0),
            date_sent: None,
            columns: HashMap::new(),
        };
        assert_eq!(
            envelope_received_date_ymd(&row).as_deref(),
            Some("2026-04-15")
        );
    }

    #[test]
    fn sample_messages_page_offset() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (n INTEGER);
             INSERT INTO messages VALUES (1);
             INSERT INTO messages VALUES (2);
             INSERT INTO messages VALUES (3);",
        )
        .unwrap();
        let p0 = sample_messages_page(&conn, 2, 0).unwrap();
        assert_eq!(p0.len(), 2);
        assert_eq!(p0[0].columns.get("n").map(String::as_str), Some("3"));
        assert_eq!(p0[1].columns.get("n").map(String::as_str), Some("2"));
        let p1 = sample_messages_page(&conn, 2, 2).unwrap();
        assert_eq!(p1.len(), 1);
        assert_eq!(p1[0].columns.get("n").map(String::as_str), Some("1"));
    }

    #[test]
    fn list_candidates_since_keyset_pages() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE messages (
                mailbox INTEGER NOT NULL,
                date_received INTEGER,
                date_sent INTEGER,
                deleted INTEGER NOT NULL DEFAULT 0,
                flags INTEGER NOT NULL DEFAULT 0
            );
             INSERT INTO messages VALUES (1, 1700000000, NULL, 0, 0);
             INSERT INTO messages VALUES (1, 1700000100, NULL, 0, 0);
             INSERT INTO messages VALUES (1, 1700000200, NULL, 0, 0);
             INSERT INTO messages VALUES (2, 1690000000, NULL, 0, 0);",
        )
        .unwrap();
        let since = 1_700_000_000_i64;
        let p0 = list_candidates_since_keyset(&conn, 2, since, None, false).unwrap();
        assert_eq!(p0.len(), 2);
        assert_eq!(p0[0].rowid, 3);
        assert_eq!(p0[0].date_received, 1_700_000_200);
        assert_eq!(p0[1].rowid, 2);
        let after = (p0[1].date_received, p0[1].rowid);
        let p1 = list_candidates_since_keyset(&conn, 10, since, Some(after), false).unwrap();
        assert_eq!(p1.len(), 1);
        assert_eq!(p1[0].rowid, 1);
        let after2 = (p1[0].date_received, p1[0].rowid);
        let p2 = list_candidates_since_keyset(&conn, 10, since, Some(after2), false).unwrap();
        assert!(p2.is_empty());
    }

    #[test]
    fn validate_envelope_index_for_setup_rejects_missing_path() {
        let err =
            validate_envelope_index_for_setup(Some("/nonexistent/V10/mail/root")).unwrap_err();
        assert!(
            err.contains("Envelope Index") || err.contains("not found"),
            "got: {err}"
        );
    }
}
