//! Read-only access to macOS Calendar.app SQLite (`Calendar.sqlitedb` in the app group container).
//!
//! Same pattern as Apple Mail [`crate::applemail::envelope_index`] — no EventKit, `PRAGMA query_only`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::model::CalendarEventRow;

/// Seconds between Unix epoch and Apple Core Data reference date (2001-01-01 00:00:00 UTC).
pub const CORE_DATA_EPOCH_UNIX_OFFSET_SECS: i64 = 978_307_200;

/// Path to Calendar’s main store under the user’s Library (requires Full Disk Access for CLI tools).
#[must_use]
pub fn apple_calendar_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(
        home.join("Library")
            .join("Group Containers")
            .join("group.com.apple.calendar")
            .join("Calendar.sqlitedb"),
    )
}

/// Open Apple’s calendar DB read-only (no writes; avoid WAL side effects).
pub fn open_apple_calendar_readonly(path: &Path) -> rusqlite::Result<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    conn.execute_batch("PRAGMA query_only = ON;")?;
    Ok(conn)
}

/// Convert `CalendarItem` / `last_modified` `REAL` values to Unix seconds.
///
/// Calendar.app stores times either as **Unix seconds** (modern DBs, ≈ 1e9–1.7e9), **Unix
/// milliseconds** (`≥ 1e12`), or **Cocoa** seconds since 2001-01-01 (smaller values) — same
/// heuristics as [`crate::applemail::envelope_index::apple_mail_time_to_ymd`].
#[must_use]
pub fn apple_calendar_timestamp_to_unix_secs(ts: Option<f64>) -> Option<i64> {
    let t = ts?;
    if !t.is_finite() {
        return None;
    }
    if t >= 1e12 {
        return Some((t / 1000.0) as i64);
    }
    if t >= 1_000_000_000.0 {
        return Some(t as i64);
    }
    Some(CORE_DATA_EPOCH_UNIX_OFFSET_SECS + t as i64)
}

fn attendees_csv_to_json(csv: Option<String>) -> Option<String> {
    let csv = csv?;
    let s = csv.trim();
    if s.is_empty() {
        return None;
    }
    let emails: Vec<&str> = s
        .split(',')
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .collect();
    if emails.is_empty() {
        return None;
    }
    serde_json::to_string(&emails).ok()
}

/// Map `CalendarItem.status` integer to a short string (best-effort; values vary by OS).
fn calendar_item_status_str(status: Option<i64>) -> Option<String> {
    let s = status?;
    Some(
        match s {
            0 => "none",
            1 => "confirmed",
            2 => "tentative",
            3 => "cancelled",
            _ => return Some(s.to_string()),
        }
        .to_string(),
    )
}

/// Start/end Unix times for one [`OccurrenceCache`] row (timed or all-day).
///
/// All-day slices use Calendar’s `day` (local midnight for that chip). Multi-day all-day series
/// also set `occurrence_start_date` to the **series** start on later slices — we must not use
/// that for positioning (or every slice would overlap the first day).
///
/// Timed instances: prefer `occurrence_date` (true start), then `occurrence_start_date`, then `day`.
fn occurrence_bounds_unix(
    all_day: bool,
    day: f64,
    occurrence_date: Option<f64>,
    occurrence_start: Option<f64>,
    occurrence_end: Option<f64>,
    master_start: Option<f64>,
    master_end: Option<f64>,
) -> (i64, i64) {
    if all_day {
        let day_start = apple_calendar_timestamp_to_unix_secs(Some(day)).unwrap_or(0);
        let next_day = apple_calendar_timestamp_to_unix_secs(Some(day + 86_400.0))
            .unwrap_or(day_start.saturating_add(86_400));
        let end_at = next_day.saturating_sub(1).max(day_start);
        return (day_start, end_at);
    }

    let start_raw = occurrence_date
        .filter(|t| t.is_finite())
        .or(occurrence_start.filter(|t| t.is_finite()))
        .or(Some(day));
    let start_at = apple_calendar_timestamp_to_unix_secs(start_raw).unwrap_or(0);

    let end_at = apple_calendar_timestamp_to_unix_secs(occurrence_end).unwrap_or_else(|| {
        let ms = apple_calendar_timestamp_to_unix_secs(master_start).unwrap_or(start_at);
        let me = apple_calendar_timestamp_to_unix_secs(master_end).unwrap_or(ms + 3600);
        let dur = (me - ms).max(60);
        start_at.saturating_add(dur)
    });
    let end_at = end_at.max(start_at + 60);
    (start_at, end_at)
}

#[must_use]
fn calendar_name_from_title(title: Option<String>) -> Option<String> {
    title.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// Map Apple `Calendar.ROWID` (as string) → `Calendar.title` for `calendar list-calendars` / agents.
pub fn read_apple_calendar_name_map(
    apple: &Connection,
) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = apple.prepare(
        "SELECT CAST(ROWID AS TEXT), title FROM Calendar WHERE title IS NOT NULL AND TRIM(title) != ''",
    )?;
    let mut m = HashMap::new();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (id, title) = row?;
        m.insert(id, title);
    }
    Ok(m)
}

fn synthetic_occurrence_uid(base_uid: &str, ci_rowid: i64, occ_sqlite_rowid: i64) -> String {
    let base = base_uid.trim();
    if base.is_empty() {
        format!("apple-cal-item-{ci_rowid}#occ{occ_sqlite_rowid}")
    } else {
        format!("{base}#occ{occ_sqlite_rowid}")
    }
}

/// Read visible events from Apple’s calendar DB into normalized rows.
///
/// Expands **recurring** and **multi-day** events using [`OccurrenceCache`] (one row per
/// displayed instance). Items with no cache rows (older / pruned data) fall back to a single
/// row from [`CalendarItem`].
///
/// `source_id` / `source_kind` are the ripmail source (`appleCalendar`). All calendars are
/// returned; use `default_calendars` in ripmail config to limit default queries.
pub fn read_apple_calendar_events(
    apple: &Connection,
    source_id: &str,
    source_kind: &str,
) -> rusqlite::Result<Vec<CalendarEventRow>> {
    let sql_occ = r"
SELECT
  oc.rowid AS occ_rowid,
  ci.ROWID AS ci_rowid,
  COALESCE(NULLIF(TRIM(ci.unique_identifier), ''), NULLIF(TRIM(ci.UUID), '')) AS base_uid,
  ci.summary,
  ci.description,
  oc.day AS oc_day,
  oc.occurrence_date AS oc_occurrence_date,
  oc.occurrence_start_date AS oc_occurrence_start,
  oc.occurrence_end_date AS oc_occurrence_end,
  ci.start_date AS master_start,
  ci.end_date AS master_end,
  ci.start_tz,
  ci.end_tz,
  ci.all_day,
  ci.status,
  ci.last_modified,
  CAST(ci.calendar_id AS TEXT) AS calendar_id,
  c.title AS calendar_title,
  c.color AS calendar_color,
  l.title AS location_title,
  p.email AS organizer_email,
  ident.display_name AS organizer_name,
  (SELECT GROUP_CONCAT(ip.email, ',')
   FROM Participant ip
   WHERE ip.owner_id = ci.ROWID
     AND ip.email IS NOT NULL
     AND TRIM(ip.email) != '') AS attendees_csv
FROM OccurrenceCache oc
INNER JOIN CalendarItem ci ON oc.event_id = ci.ROWID
LEFT JOIN Calendar c ON ci.calendar_id = c.ROWID
LEFT JOIN Location l ON ci.location_id = l.ROWID
LEFT JOIN Participant p ON ci.organizer_id = p.ROWID
LEFT JOIN Identity ident ON p.identity_id = ident.ROWID
WHERE ci.entity_type IN (0, 2)
  AND ci.hidden = 0
";

    let sql_fallback = r"
SELECT
  ci.ROWID,
  COALESCE(NULLIF(TRIM(ci.unique_identifier), ''), NULLIF(TRIM(ci.UUID), '')) AS uid,
  ci.summary,
  ci.description,
  ci.start_date,
  ci.start_tz,
  ci.end_date,
  ci.end_tz,
  ci.all_day,
  ci.status,
  ci.last_modified,
  CAST(ci.calendar_id AS TEXT) AS calendar_id,
  c.title AS calendar_title,
  c.color AS calendar_color,
  l.title AS location_title,
  p.email AS organizer_email,
  ident.display_name AS organizer_name,
  (SELECT GROUP_CONCAT(ip.email, ',')
   FROM Participant ip
   WHERE ip.owner_id = ci.ROWID
     AND ip.email IS NOT NULL
     AND TRIM(ip.email) != '') AS attendees_csv
FROM CalendarItem ci
LEFT JOIN Calendar c ON ci.calendar_id = c.ROWID
LEFT JOIN Location l ON ci.location_id = l.ROWID
LEFT JOIN Participant p ON ci.organizer_id = p.ROWID
LEFT JOIN Identity ident ON p.identity_id = ident.ROWID
WHERE ci.entity_type IN (0, 2)
  AND ci.hidden = 0
  AND NOT EXISTS (SELECT 1 FROM OccurrenceCache oc WHERE oc.event_id = ci.ROWID)
";

    let mut out = Vec::new();

    let mut stmt = apple.prepare(sql_occ)?;
    let occ_rows = stmt.query_map([], |r| {
        let occ_rowid: i64 = r.get(0)?;
        let ci_rowid: i64 = r.get(1)?;
        let base_uid: Option<String> = r.get(2)?;
        let base = base_uid.as_deref().unwrap_or("").trim();
        let uid = synthetic_occurrence_uid(base, ci_rowid, occ_rowid);

        let summary: Option<String> = r.get(3)?;
        let description: Option<String> = r.get(4)?;
        let oc_day: f64 = r.get(5)?;
        let oc_occurrence_date: Option<f64> = r.get(6)?;
        let oc_occurrence_start: Option<f64> = r.get(7)?;
        let oc_occurrence_end: Option<f64> = r.get(8)?;
        let master_start: Option<f64> = r.get(9)?;
        let master_end: Option<f64> = r.get(10)?;
        let start_tz: Option<String> = r.get(11)?;
        let end_tz: Option<String> = r.get(12)?;
        let all_day: i64 = r.get(13)?;
        let status: Option<i64> = r.get(14)?;
        let last_modified: Option<f64> = r.get(15)?;
        let calendar_id: String = r.get(16)?;
        let calendar_title: Option<String> = r.get(17)?;
        let calendar_name = calendar_name_from_title(calendar_title);
        let calendar_color: Option<String> = r.get(18)?;
        let location_title: Option<String> = r.get(19)?;
        let organizer_email: Option<String> = r.get(20)?;
        let organizer_name: Option<String> = r.get(21)?;
        let attendees_csv: Option<String> = r.get(22)?;

        let (start_at, end_at) = occurrence_bounds_unix(
            all_day != 0,
            oc_day,
            oc_occurrence_date,
            oc_occurrence_start,
            oc_occurrence_end,
            master_start,
            master_end,
        );
        let tz = start_tz
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(end_tz.as_deref().filter(|s| !s.is_empty()))
            .map(str::to_string);

        let raw_json = serde_json::json!({
            "apple_calendar_item_rowid": ci_rowid,
            "apple_occurrence_rowid": occ_rowid,
            "calendar_id": calendar_id,
            "summary": summary,
        })
        .to_string();

        Ok(CalendarEventRow {
            source_id: source_id.to_string(),
            source_kind: source_kind.to_string(),
            calendar_id,
            calendar_name,
            uid,
            summary,
            description,
            location: location_title,
            start_at,
            end_at,
            all_day: all_day != 0,
            timezone: tz,
            status: calendar_item_status_str(status),
            rrule: None,
            recurrence_json: None,
            attendees_json: attendees_csv_to_json(attendees_csv),
            organizer_email,
            organizer_name,
            updated_at: apple_calendar_timestamp_to_unix_secs(last_modified),
            synced_at: None,
            color: calendar_color,
            raw_json: Some(raw_json),
        })
    })?;
    for row in occ_rows {
        out.push(row?);
    }

    let mut stmt = apple.prepare(sql_fallback)?;
    let fb_rows = stmt.query_map([], |r| {
        let rowid: i64 = r.get(0)?;
        let uid_opt: Option<String> = r.get(1)?;
        let uid = uid_opt
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("apple-cal-item-{rowid}"));

        let summary: Option<String> = r.get(2)?;
        let description: Option<String> = r.get(3)?;
        let start_date: Option<f64> = r.get(4)?;
        let start_tz: Option<String> = r.get(5)?;
        let end_date: Option<f64> = r.get(6)?;
        let end_tz: Option<String> = r.get(7)?;
        let all_day: i64 = r.get(8)?;
        let status: Option<i64> = r.get(9)?;
        let last_modified: Option<f64> = r.get(10)?;
        let calendar_id: String = r.get(11)?;
        let calendar_title: Option<String> = r.get(12)?;
        let calendar_name = calendar_name_from_title(calendar_title);
        let calendar_color: Option<String> = r.get(13)?;
        let location_title: Option<String> = r.get(14)?;
        let organizer_email: Option<String> = r.get(15)?;
        let organizer_name: Option<String> = r.get(16)?;
        let attendees_csv: Option<String> = r.get(17)?;

        let start_at = apple_calendar_timestamp_to_unix_secs(start_date).unwrap_or(0);
        let end_at = apple_calendar_timestamp_to_unix_secs(end_date).unwrap_or(start_at);
        let tz = start_tz
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(end_tz.as_deref().filter(|s| !s.is_empty()))
            .map(str::to_string);

        let raw_json = serde_json::json!({
            "apple_calendar_item_rowid": rowid,
            "calendar_id": calendar_id,
            "summary": summary,
        })
        .to_string();

        Ok(CalendarEventRow {
            source_id: source_id.to_string(),
            source_kind: source_kind.to_string(),
            calendar_id,
            calendar_name,
            uid,
            summary,
            description,
            location: location_title,
            start_at,
            end_at,
            all_day: all_day != 0,
            timezone: tz,
            status: calendar_item_status_str(status),
            rrule: None,
            recurrence_json: None,
            attendees_json: attendees_csv_to_json(attendees_csv),
            organizer_email,
            organizer_name,
            updated_at: apple_calendar_timestamp_to_unix_secs(last_modified),
            synced_at: None,
            color: calendar_color,
            raw_json: Some(raw_json),
        })
    })?;
    for row in fb_rows {
        out.push(row?);
    }

    Ok(out)
}

/// If the Calendar DB exists but cannot be opened read-only, return an FDA-oriented message.
pub fn calendar_db_readable_or_reason() -> Result<(), String> {
    let Some(path) = apple_calendar_db_path() else {
        return Err("Could not resolve home directory.".into());
    };
    if !path.is_file() {
        // No store yet or non-macOS layout — not necessarily an error for setup.
        return Ok(());
    }
    open_apple_calendar_readonly(&path).map_err(|e| {
        format!(
            "Could not open Apple Calendar database read-only at:\n  {}\n\n\
             Grant Full Disk Access to this terminal app (Terminal, iTerm, Cursor, …):\n\
             System Settings → Privacy & Security → Full Disk Access.\n\
             Underlying error: {e}",
            path.display()
        )
    })?;
    Ok(())
}

/// Print a warning to stderr when the DB file exists but is not readable (e.g. missing FDA).
pub fn warn_calendar_db_read_access() {
    if !cfg!(target_os = "macos") {
        return;
    }
    if let Err(msg) = calendar_db_readable_or_reason() {
        eprintln!("ripmail: {msg}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn apple_calendar_timestamp_cocoa_reference_date() {
        assert_eq!(
            apple_calendar_timestamp_to_unix_secs(Some(0.0)),
            Some(CORE_DATA_EPOCH_UNIX_OFFSET_SECS)
        );
    }

    /// Regression: modern Calendar stores all-day and many events as **Unix** seconds in `start_date`.
    #[test]
    fn apple_calendar_timestamp_unix_seconds_not_cocoa() {
        // 2019-01-01 00:00:00 UTC (seen in real Calendar.sqlitedb for all-day holidays).
        assert_eq!(
            apple_calendar_timestamp_to_unix_secs(Some(1_546_300_800.0)),
            Some(1_546_300_800)
        );
    }

    #[test]
    fn apple_calendar_timestamp_unix_millis() {
        assert_eq!(
            apple_calendar_timestamp_to_unix_secs(Some(1_546_300_800_000.0)),
            Some(1_546_300_800)
        );
    }

    #[test]
    fn apple_calendar_timestamp_none_and_nan() {
        assert_eq!(apple_calendar_timestamp_to_unix_secs(None), None);
        assert_eq!(apple_calendar_timestamp_to_unix_secs(Some(f64::NAN)), None);
    }

    /// Cocoa offset + fractional seconds (truncates toward zero).
    #[test]
    fn apple_calendar_timestamp_cocoa_fractional() {
        assert_eq!(
            apple_calendar_timestamp_to_unix_secs(Some(1_000_000.25)),
            Some(CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 1_000_000)
        );
    }

    #[test]
    fn attendees_csv_to_json_empty() {
        assert_eq!(attendees_csv_to_json(None), None);
        assert_eq!(attendees_csv_to_json(Some("".into())), None);
        assert_eq!(attendees_csv_to_json(Some("  ".into())), None);
    }

    #[test]
    fn attendees_csv_to_json_values() {
        let j = attendees_csv_to_json(Some("a@b.com, c@d.com ".into())).unwrap();
        assert!(j.contains("a@b.com"));
        assert!(j.contains("c@d.com"));
    }

    #[test]
    fn read_apple_calendar_events_minimal_schema() {
        let apple = Connection::open_in_memory().unwrap();
        apple
            .execute_batch(
                r"
CREATE TABLE Calendar (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  color TEXT
);
CREATE TABLE Location (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT
);
CREATE TABLE Identity (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT,
  address TEXT,
  first_name TEXT,
  last_name TEXT
);
CREATE TABLE Participant (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type INTEGER,
  type INTEGER,
  status INTEGER,
  identity_id INTEGER,
  owner_id INTEGER,
  email TEXT
);
CREATE TABLE CalendarItem (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT,
  location_id INTEGER,
  description TEXT,
  start_date REAL,
  start_tz TEXT,
  end_date REAL,
  end_tz TEXT,
  all_day INTEGER,
  calendar_id INTEGER,
  organizer_id INTEGER,
  status INTEGER,
  unique_identifier TEXT,
  UUID TEXT,
  entity_type INTEGER,
  hidden INTEGER,
  last_modified REAL
);
CREATE TABLE OccurrenceCache (
  day REAL,
  event_id INTEGER,
  calendar_id INTEGER,
  store_id INTEGER,
  occurrence_date REAL,
  occurrence_start_date REAL,
  occurrence_end_date REAL,
  latest_possible_alarm REAL,
  earliest_possible_alarm REAL,
  next_reminder_date REAL
);
INSERT INTO Calendar (title, color) VALUES ('Home', '#ff0000');
INSERT INTO Location (title) VALUES ('Room A');
INSERT INTO CalendarItem (
  summary, location_id, description,
  start_date, start_tz, end_date, end_tz, all_day,
  calendar_id, organizer_id, status, unique_identifier, UUID,
  entity_type, hidden, last_modified
) VALUES (
  'Test event', 1, 'Desc',
  1000000.0, 'America/Los_Angeles', 1000060.0, 'America/Los_Angeles', 0,
  1, NULL, 1, 'uid-1', NULL,
  0, 0, 2000000.0
);
",
            )
            .unwrap();

        let rows = read_apple_calendar_events(&apple, "src1", "appleCalendar").unwrap();
        assert_eq!(rows.len(), 1);
        let e = &rows[0];
        assert_eq!(e.uid, "uid-1");
        assert_eq!(e.summary.as_deref(), Some("Test event"));
        assert_eq!(e.calendar_id, "1");
        assert_eq!(e.calendar_name.as_deref(), Some("Home"));
        assert_eq!(e.all_day, false);
        assert_eq!(e.status.as_deref(), Some("confirmed"));
        assert_eq!(e.start_at, CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 1_000_000);
        assert_eq!(e.timezone.as_deref(), Some("America/Los_Angeles"));
        assert_eq!(e.location.as_deref(), Some("Room A"));
        assert_eq!(e.color.as_deref(), Some("#ff0000"));

        let names = read_apple_calendar_name_map(&apple).unwrap();
        assert_eq!(names.get("1").map(String::as_str), Some("Home"));
    }

    /// Regression: current macOS Calendar.sqlitedb uses `entity_type = 2` for events (not `0`).
    #[test]
    fn read_apple_calendar_events_includes_entity_type_2() {
        let apple = Connection::open_in_memory().unwrap();
        apple
            .execute_batch(
                r"
CREATE TABLE Calendar (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, color TEXT);
CREATE TABLE Location (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
CREATE TABLE Identity (display_name TEXT, address TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE Participant (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type INTEGER, type INTEGER, status INTEGER,
  identity_id INTEGER, owner_id INTEGER, email TEXT
);
CREATE TABLE CalendarItem (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT, location_id INTEGER, description TEXT,
  start_date REAL, start_tz TEXT, end_date REAL, end_tz TEXT, all_day INTEGER,
  calendar_id INTEGER, organizer_id INTEGER, status INTEGER,
  unique_identifier TEXT, UUID TEXT, entity_type INTEGER, hidden INTEGER, last_modified REAL
);
INSERT INTO Calendar (title) VALUES ('Cal');
INSERT INTO CalendarItem (
  summary, start_date, end_date, all_day, calendar_id,
  unique_identifier, entity_type, hidden, last_modified
) VALUES (
  'Weekly standup', 1_546_300_800.0, 1_546_304_400.0, 0, 1,
  'regression-uid-entity-2', 2, 0, 1_546_300_800.0
);
CREATE TABLE OccurrenceCache (
  day REAL, event_id INTEGER, calendar_id INTEGER, store_id INTEGER,
  occurrence_date REAL, occurrence_start_date REAL, occurrence_end_date REAL,
  latest_possible_alarm REAL, earliest_possible_alarm REAL, next_reminder_date REAL
);
",
            )
            .unwrap();

        let rows = read_apple_calendar_events(&apple, "src", "appleCalendar").unwrap();
        assert_eq!(rows.len(), 1, "entity_type 2 rows must be indexed");
        assert_eq!(rows[0].summary.as_deref(), Some("Weekly standup"));
        assert_eq!(rows[0].uid, "regression-uid-entity-2");
        assert_eq!(rows[0].start_at, 1_546_300_800);
        assert_eq!(rows[0].end_at, 1_546_304_400);
    }

    #[test]
    fn read_apple_calendar_events_skips_unsupported_entity_types() {
        let apple = Connection::open_in_memory().unwrap();
        apple
            .execute_batch(
                r"
CREATE TABLE Calendar (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, color TEXT);
CREATE TABLE Location (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
CREATE TABLE Identity (display_name TEXT, address TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE Participant (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type INTEGER, type INTEGER, status INTEGER,
  identity_id INTEGER, owner_id INTEGER, email TEXT
);
CREATE TABLE CalendarItem (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT, location_id INTEGER, description TEXT,
  start_date REAL, start_tz TEXT, end_date REAL, end_tz TEXT, all_day INTEGER,
  calendar_id INTEGER, organizer_id INTEGER, status INTEGER,
  unique_identifier TEXT, UUID TEXT, entity_type INTEGER, hidden INTEGER, last_modified REAL
);
INSERT INTO Calendar (title) VALUES ('Cal');
INSERT INTO CalendarItem (
  summary, start_date, end_date, all_day, calendar_id,
  unique_identifier, entity_type, hidden, last_modified
) VALUES (
  'Reminder-like', 100.0, 200.0, 0, 1,
  'should-skip', 99, 0, 100.0
);
CREATE TABLE OccurrenceCache (
  day REAL, event_id INTEGER, calendar_id INTEGER, store_id INTEGER,
  occurrence_date REAL, occurrence_start_date REAL, occurrence_end_date REAL,
  latest_possible_alarm REAL, earliest_possible_alarm REAL, next_reminder_date REAL
);
",
            )
            .unwrap();

        let rows = read_apple_calendar_events(&apple, "src", "appleCalendar").unwrap();
        assert!(
            rows.is_empty(),
            "only entity_type 0 and 2 are calendar events"
        );
    }

    /// Regression: Participant rows use `entity_type` 7 / 8 in real stores, not `0`.
    #[test]
    fn read_apple_calendar_events_attendees_without_participant_entity_filter() {
        let apple = Connection::open_in_memory().unwrap();
        apple
            .execute_batch(
                r"
CREATE TABLE Calendar (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, color TEXT);
CREATE TABLE Location (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
CREATE TABLE Identity (display_name TEXT, address TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE Participant (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type INTEGER, type INTEGER, status INTEGER,
  identity_id INTEGER, owner_id INTEGER, email TEXT
);
CREATE TABLE CalendarItem (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT, location_id INTEGER, description TEXT,
  start_date REAL, start_tz TEXT, end_date REAL, end_tz TEXT, all_day INTEGER,
  calendar_id INTEGER, organizer_id INTEGER, status INTEGER,
  unique_identifier TEXT, UUID TEXT, entity_type INTEGER, hidden INTEGER, last_modified REAL
);
INSERT INTO Calendar (title) VALUES ('Cal');
INSERT INTO CalendarItem (
  summary, start_date, end_date, all_day, calendar_id,
  unique_identifier, entity_type, hidden, last_modified
) VALUES (
  'Meeting', 1_700_000_000.0, 1_700_000_100.0, 0, 1,
  'meet-1', 2, 0, 1_700_000_000.0
);
INSERT INTO Participant (entity_type, owner_id, email) VALUES (7, 1, 'a@example.com');
INSERT INTO Participant (entity_type, owner_id, email) VALUES (8, 1, 'b@example.com');
CREATE TABLE OccurrenceCache (
  day REAL, event_id INTEGER, calendar_id INTEGER, store_id INTEGER,
  occurrence_date REAL, occurrence_start_date REAL, occurrence_end_date REAL,
  latest_possible_alarm REAL, earliest_possible_alarm REAL, next_reminder_date REAL
);
",
            )
            .unwrap();

        let rows = read_apple_calendar_events(&apple, "src", "appleCalendar").unwrap();
        assert_eq!(rows.len(), 1);
        let attendees = rows[0].attendees_json.as_deref().unwrap();
        assert!(attendees.contains("a@example.com"));
        assert!(attendees.contains("b@example.com"));
    }

    /// Regression: multi-day all-day later slices set `occurrence_start_date` to the series start;
    /// each row must still use `day` so instances do not stack on the first day.
    #[test]
    fn read_apple_calendar_multi_day_all_day_uses_occurrence_day_not_series_start() {
        let apple = Connection::open_in_memory().unwrap();
        apple
            .execute_batch(
                r"
CREATE TABLE Calendar (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, color TEXT);
CREATE TABLE Location (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
CREATE TABLE Identity (display_name TEXT, address TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE Participant (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type INTEGER, type INTEGER, status INTEGER,
  identity_id INTEGER, owner_id INTEGER, email TEXT
);
CREATE TABLE CalendarItem (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT, location_id INTEGER, description TEXT,
  start_date REAL, start_tz TEXT, end_date REAL, end_tz TEXT, all_day INTEGER,
  calendar_id INTEGER, organizer_id INTEGER, status INTEGER,
  unique_identifier TEXT, UUID TEXT, entity_type INTEGER, hidden INTEGER, last_modified REAL
);
CREATE TABLE OccurrenceCache (
  day REAL, event_id INTEGER, calendar_id INTEGER, store_id INTEGER,
  occurrence_date REAL, occurrence_start_date REAL, occurrence_end_date REAL,
  latest_possible_alarm REAL, earliest_possible_alarm REAL, next_reminder_date REAL
);
INSERT INTO Calendar (title) VALUES ('Cal');
INSERT INTO CalendarItem (
  summary, start_date, end_date, all_day, calendar_id,
  unique_identifier, entity_type, hidden, last_modified
) VALUES (
  'Girls Trip', 100.0, 500.0, 1, 1,
  'trip-uid', 2, 0, 100.0
);
INSERT INTO OccurrenceCache (
  day, event_id, calendar_id, store_id,
  occurrence_date, occurrence_start_date, occurrence_end_date
) VALUES
  (1000.0, 1, 1, 0, 1000.0, NULL, 9000.0),
  (2000.0, 1, 1, 0, 2000.0, 1000.0, 9000.0);
",
            )
            .unwrap();

        let mut rows = read_apple_calendar_events(&apple, "src", "appleCalendar").unwrap();
        rows.sort_by_key(|r| r.start_at);
        assert_eq!(rows.len(), 2);
        assert_ne!(rows[0].start_at, rows[1].start_at);
        let d0 = CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 1000;
        let d1 = CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 2000;
        assert_eq!(rows[0].start_at, d0);
        assert_eq!(rows[1].start_at, d1);
    }

    /// Regression: recurring masters share one `CalendarItem` but many `OccurrenceCache` rows.
    #[test]
    fn read_apple_calendar_events_expands_occurrence_cache_instances() {
        let apple = Connection::open_in_memory().unwrap();
        apple
            .execute_batch(
                r"
CREATE TABLE Calendar (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, color TEXT);
CREATE TABLE Location (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
CREATE TABLE Identity (display_name TEXT, address TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE Participant (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type INTEGER, type INTEGER, status INTEGER,
  identity_id INTEGER, owner_id INTEGER, email TEXT
);
CREATE TABLE CalendarItem (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT, location_id INTEGER, description TEXT,
  start_date REAL, start_tz TEXT, end_date REAL, end_tz TEXT, all_day INTEGER,
  calendar_id INTEGER, organizer_id INTEGER, status INTEGER,
  unique_identifier TEXT, UUID TEXT, entity_type INTEGER, hidden INTEGER, last_modified REAL
);
CREATE TABLE OccurrenceCache (
  day REAL, event_id INTEGER, calendar_id INTEGER, store_id INTEGER,
  occurrence_date REAL, occurrence_start_date REAL, occurrence_end_date REAL,
  latest_possible_alarm REAL, earliest_possible_alarm REAL, next_reminder_date REAL
);
INSERT INTO Calendar (title) VALUES ('Cal');
INSERT INTO CalendarItem (
  summary, start_date, end_date, all_day, calendar_id,
  unique_identifier, entity_type, hidden, last_modified
) VALUES (
  'Weekly sync', 100.0, 200.0, 0, 1,
  'recur-master-uid', 2, 0, 100.0
);
INSERT INTO OccurrenceCache (
  day, event_id, calendar_id, store_id,
  occurrence_date, occurrence_start_date, occurrence_end_date
) VALUES
  (1000.0, 1, 1, 0, 1000.0, NULL, 1060.0),
  (2000.0, 1, 1, 0, 2000.0, NULL, 2060.0);
",
            )
            .unwrap();

        let mut rows = read_apple_calendar_events(&apple, "src", "appleCalendar").unwrap();
        rows.sort_by_key(|r| r.start_at);
        assert_eq!(rows.len(), 2);
        assert!(rows[0].uid.starts_with("recur-master-uid#occ"));
        assert!(rows[1].uid.starts_with("recur-master-uid#occ"));
        assert_ne!(rows[0].uid, rows[1].uid);
        assert_eq!(rows[0].start_at, CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 1000);
        assert_eq!(rows[0].end_at, CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 1060);
        assert_eq!(rows[1].start_at, CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 2000);
        assert_eq!(rows[1].end_at, CORE_DATA_EPOCH_UNIX_OFFSET_SECS + 2060);
    }

    #[test]
    fn uid_falls_back_to_rowid_when_missing() {
        let apple = Connection::open_in_memory().unwrap();
        apple
            .execute_batch(
                r"
CREATE TABLE Calendar (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, color TEXT);
CREATE TABLE Location (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);
CREATE TABLE Identity (display_name TEXT, address TEXT, first_name TEXT, last_name TEXT);
CREATE TABLE Participant (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type INTEGER, type INTEGER, status INTEGER,
  identity_id INTEGER, owner_id INTEGER, email TEXT
);
CREATE TABLE CalendarItem (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
  summary TEXT, location_id INTEGER, description TEXT,
  start_date REAL, start_tz TEXT, end_date REAL, end_tz TEXT, all_day INTEGER,
  calendar_id INTEGER, organizer_id INTEGER, status INTEGER,
  unique_identifier TEXT, UUID TEXT, entity_type INTEGER, hidden INTEGER, last_modified REAL
);
INSERT INTO Calendar (title) VALUES ('X');
INSERT INTO CalendarItem (
  summary, start_date, end_date, all_day, calendar_id,
  unique_identifier, UUID, entity_type, hidden, last_modified
) VALUES (
  'No uid', 0.0, 3600.0, 0, 1, '', '', 0, 0, 0.0
);
CREATE TABLE OccurrenceCache (
  day REAL, event_id INTEGER, calendar_id INTEGER, store_id INTEGER,
  occurrence_date REAL, occurrence_start_date REAL, occurrence_end_date REAL,
  latest_possible_alarm REAL, earliest_possible_alarm REAL, next_reminder_date REAL
);
",
            )
            .unwrap();
        let rows = read_apple_calendar_events(&apple, "s", "appleCalendar").unwrap();
        assert_eq!(rows[0].uid, "apple-cal-item-1");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn open_real_calendar_db_if_present() {
        let Some(p) = apple_calendar_db_path() else {
            return;
        };
        if !p.is_file() {
            return;
        }
        let Ok(conn) = open_apple_calendar_readonly(&p) else {
            // File may exist but be unreadable without Full Disk Access (or sandbox).
            return;
        };
        let rows = read_apple_calendar_events(&conn, "integration-test", "appleCalendar")
            .expect("read events");
        let _ = rows.len();
    }

    /// Regression: reader row count must match visible event-like rows in a real store when present.
    #[cfg(target_os = "macos")]
    #[test]
    fn real_calendar_db_row_count_matches_sql_when_populated() {
        let Some(p) = apple_calendar_db_path() else {
            return;
        };
        if !p.is_file() {
            return;
        }
        let Ok(apple) = open_apple_calendar_readonly(&p) else {
            return;
        };
        let expected: i64 = apple
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM OccurrenceCache oc
                    INNER JOIN CalendarItem ci ON oc.event_id = ci.ROWID
                    WHERE ci.hidden = 0 AND ci.entity_type IN (0, 2))
                 + (SELECT COUNT(*) FROM CalendarItem ci
                    WHERE ci.hidden = 0 AND ci.entity_type IN (0, 2)
                    AND NOT EXISTS (SELECT 1 FROM OccurrenceCache oc WHERE oc.event_id = ci.ROWID))",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if expected == 0 {
            return;
        }
        let rows = read_apple_calendar_events(&apple, "count-test", "appleCalendar").unwrap();
        assert_eq!(
            rows.len() as i64,
            expected,
            "read_apple_calendar_events = OccurrenceCache rows + CalendarItems without cache"
        );
    }
}
