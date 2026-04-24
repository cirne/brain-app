//! Index-time normalization for `ParsedMessage::date` (UTC RFC3339 strings).
//!
//! Some corpora (e.g. Enron/Notes exports) include `Date` values that land before a sensible
//! “inbox” window when parsed to UTC. On ingest we clamp suspicious stored dates to the smallest
//! trustworthy date already present (per rebuild batch, or per mailbox in SQLite). If there is
//! no trustworthy anchor yet, bogus rows are **skipped** (not indexed) and a warning is printed.

use std::fs;

use chrono::{DateTime, Utc};
use rayon::prelude::*;

use super::parse_message::parse_index_message;
use super::ParsedMessage;

/// Messages with an index `date` strictly before this instant are treated as untrustworthy for
/// product metrics (`status` range, recency, etc.) and are normalized on ingest.
pub(crate) const TRUSTWORTHY_INDEX_EARLIEST: &str = "1990-01-01T00:00:00+00:00";

fn trustworthy_cutoff_utc() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(TRUSTWORTHY_INDEX_EARLIEST)
        .map(|d| d.with_timezone(&Utc))
        .expect("static RFC3339")
}

/// Parsed stored `date` in UTC, if the string is valid RFC3339.
pub(crate) fn parse_stored_index_date_utc(s: &str) -> Option<DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// True when this instant should be replaced or the message dropped at index time.
pub(crate) fn is_untrustworthy_index_date(utc: DateTime<Utc>) -> bool {
    if utc.timestamp() == 0 {
        return true;
    }
    utc < trustworthy_cutoff_utc()
}

/// True when the stored RFC3339 string is missing, invalid, or before [`TRUSTWORTHY_INDEX_EARLIEST`].
fn is_untrustworthy_index_date_str(s: &str) -> bool {
    match parse_stored_index_date_utc(s) {
        None => true,
        Some(utc) => is_untrustworthy_index_date(utc),
    }
}

/// `MIN(date)` for `source_id` (RFC3339), or `None` if the mailbox has no rows.
fn min_index_date_for_source(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> rusqlite::Result<Option<String>> {
    let v: Option<String> = conn.query_row(
        "SELECT MIN(date) FROM messages WHERE source_id = ?1",
        [source_id],
        |row| row.get(0),
    )?;
    Ok(v)
}

/// IMAP/Apple-style incremental ingest: use existing rows’ minimum `date` as the replacement, or
/// drop the message when the mailbox is still empty. Returns `Ok(true)` to continue with insert.
pub(crate) fn apply_mailbox_index_date_normalization(
    conn: &rusqlite::Connection,
    source_id: &str,
    parsed: &mut ParsedMessage,
    raw_path: &str,
) -> rusqlite::Result<bool> {
    if !is_untrustworthy_index_date_str(&parsed.date) {
        return Ok(true);
    }
    let was = parsed.date.clone();
    match min_index_date_for_source(conn, source_id)? {
        None => {
            eprintln!(
                "ripmail: warning: index date untrustworthy ({was}); no existing messages for source_id={source_id}; skipping ingest path={raw_path}",
            );
            Ok(false)
        }
        Some(min_s) => {
            eprintln!(
                "ripmail: warning: index date untrustworthy ({was}); normalized to MIN(date)={min_s} for source_id={source_id} path={raw_path}",
            );
            parsed.date = min_s;
            Ok(true)
        }
    }
}

/// Rebuild from maildir: `floor` is the minimum trustworthy `date` in the batch (pre-scan), or
/// `None` if every message was untrustworthy. Returns `true` to continue with insert.
pub(crate) fn apply_rebuild_index_date_normalization(
    parsed: &mut ParsedMessage,
    floor: Option<&str>,
    raw_path: &str,
) -> bool {
    if !is_untrustworthy_index_date_str(&parsed.date) {
        return true;
    }
    let was = parsed.date.clone();
    match floor {
        Some(anchor) => {
            eprintln!(
                "ripmail: warning: index date untrustworthy ({was}); normalized to batch min={anchor} path={raw_path}",
            );
            parsed.date = anchor.to_string();
            true
        }
        None => {
            eprintln!(
                "ripmail: warning: index date untrustworthy ({was}); no trustworthy batch anchor; skipping path={raw_path}",
            );
            false
        }
    }
}

/// Scans all `.eml` paths and returns the minimum **trustworthy** `ParsedMessage::date` in the
/// batch, or `None` if there were no parseable trustworthy dates.
pub(crate) fn min_trustworthy_index_date_in_maildir(
    paths: &[std::path::PathBuf],
) -> Option<String> {
    let anchor = std::sync::Mutex::new(None::<DateTime<Utc>>);
    paths.par_iter().for_each(|path| {
        let Ok(bytes) = fs::read(path) else {
            return;
        };
        let p = parse_index_message(&bytes);
        let Some(utc) = parse_stored_index_date_utc(&p.date) else {
            return;
        };
        if is_untrustworthy_index_date(utc) {
            return;
        }
        let mut g = anchor.lock().expect("mutex");
        *g = match *g {
            None => Some(utc),
            Some(cur) if utc < cur => Some(utc),
            Some(cur) => Some(cur),
        };
    });
    let inner = anchor.into_inner().expect("mutex");
    inner.map(|d| d.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::db::open_memory;
    use crate::persist_message;
    use crate::sync::parse_message::parse_index_message;
    use crate::sync::ParsedMessage;

    fn minimal_parsed(id: &str, date: &str) -> ParsedMessage {
        ParsedMessage {
            message_id: id.into(),
            from_address: "a@b.com".into(),
            to_addresses: vec!["b@c.com".into()],
            date: date.into(),
            subject: "s".into(),
            body_text: "x".into(),
            ..Default::default()
        }
    }

    #[test]
    fn unparseable_and_pre_1990_untrustworthy() {
        assert!(is_untrustworthy_index_date_str("not-a-date"));
        assert!(is_untrustworthy_index_date_str("1980-01-01T00:00:00+00:00"));
        assert!(!is_untrustworthy_index_date_str(
            "1990-01-01T00:00:00+00:00"
        ));
        assert!(!is_untrustworthy_index_date_str(
            "1997-03-14T00:00:00+00:00"
        ));
    }

    #[test]
    fn rebuild_normalizes_to_floor() {
        let mut p = minimal_parsed("<x>", "1980-01-01T00:00:00+00:00");
        let floor = "1997-01-15T12:00:00+00:00";
        assert!(apply_rebuild_index_date_normalization(
            &mut p,
            Some(floor),
            "a.eml"
        ));
        assert_eq!(p.date, floor);
    }

    #[test]
    fn rebuild_drops_without_floor() {
        let mut p = minimal_parsed("<x>", "1980-01-01T00:00:00+00:00");
        assert!(!apply_rebuild_index_date_normalization(
            &mut p, None, "a.eml"
        ));
    }

    #[test]
    fn mailbox_drops_on_empty() {
        let conn = open_memory().unwrap();
        let mut p = minimal_parsed("<a@1>", "1980-01-01T00:00:00+00:00");
        assert!(!apply_mailbox_index_date_normalization(&conn, "mb", &mut p, "x").unwrap());
    }

    #[test]
    fn mailbox_replaces_from_min() {
        let conn = open_memory().unwrap();
        let mut first = minimal_parsed("<a@1>", "1998-01-01T00:00:00+00:00");
        assert!(persist_message(&conn, &mut first, "INBOX", "mb", 1, "[]", "a").unwrap());
        let mut second = minimal_parsed("<a@2>", "1980-01-01T00:00:00+00:00");
        assert!(apply_mailbox_index_date_normalization(&conn, "mb", &mut second, "b").unwrap());
        assert_eq!(second.date, "1998-01-01T00:00:00+00:00");
        assert!(persist_message(&conn, &mut second, "INBOX", "mb", 2, "[]", "b").unwrap());
    }

    fn write_minimal_eml(dir: &Path, name: &str, date_line: &str) {
        fs::create_dir_all(dir).unwrap();
        let body = format!(
            "Message-ID: <{name}@t.test>\r\n\
             From: a@b.com\r\n\
             {date_line}\
             Subject: t\r\n\
             \r\n\
             x\r\n"
        );
        fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn min_trustworthy_from_dir_two_files() {
        let tmp = std::env::temp_dir().join(format!(
            "ripmail-ingest-date-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        if tmp.exists() {
            let _ = fs::remove_dir_all(&tmp);
        }
        let cur = tmp.join("cur");
        write_minimal_eml(
            &cur,
            "good.eml",
            "Date: Fri, 15 Mar 1997 08:00:00 -0600\r\n",
        );
        write_minimal_eml(&cur, "bad.eml", "Date: Mon, 31 Dec 1979 16:00:00 -0800\r\n");
        let paths = vec![cur.join("good.eml"), cur.join("bad.eml")];
        let m = min_trustworthy_index_date_in_maildir(&paths);
        assert!(m.is_some());
        let good = parse_index_message(&fs::read(&cur.join("good.eml")).unwrap());
        // Batch min is the 1997 message only.
        assert_eq!(m.as_deref(), Some(good.date.as_str()));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn parse_index_message_1979_is_untrustworthy_string() {
        let cur = std::env::temp_dir().join(format!(
            "ripmail-ingest-date-parse-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        fs::create_dir_all(&cur).unwrap();
        let p = cur.join("x.eml");
        let raw = b"Message-ID: <e@t>\r\nFrom: a@b.com\r\nDate: Mon, 31 Dec 1979 16:00:00 -0800\r\nSubject: s\r\n\r\nb";
        fs::write(&p, raw).unwrap();
        let parsed = parse_index_message(raw);
        assert!(
            is_untrustworthy_index_date_str(&parsed.date),
            "got {}",
            parsed.date
        );
        let _ = fs::remove_dir_all(&cur);
    }
}
