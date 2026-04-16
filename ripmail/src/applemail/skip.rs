//! Skip junk, deleted, drafts, and obvious trash/spam folders using Envelope Index metadata (no `.emlx` read).

use std::collections::HashMap;

use rusqlite::Connection;

use super::envelope_index::{EnvelopeCandidate, EnvelopeMessageRow};

/// Bit positions match Mail’s `.emlx` / message flags (see community docs; stable across many macOS versions).
const FLAG_DELETED: u64 = 1 << 1;
const FLAG_DRAFT: u64 = 1 << 6;
const FLAG_JUNK: u64 = 1 << 24;
const FLAG_NOT_JUNK: u64 = 1 << 25;

fn column_truthy_int(row: &EnvelopeMessageRow, name: &str) -> Option<i64> {
    let v = row
        .columns
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, s)| s.as_str())?;
    if v.is_empty() {
        return None;
    }
    v.trim().parse().ok()
}

fn column_u64(row: &EnvelopeMessageRow, name: &str) -> Option<u64> {
    let v = column_truthy_int(row, name)?;
    if v < 0 {
        return None;
    }
    Some(v as u64)
}

/// Same rules as [`envelope_row_skip_reason`], for [`EnvelopeCandidate`] (typed columns, no `HashMap`).
#[must_use]
pub fn envelope_candidate_skip_reason(c: &EnvelopeCandidate) -> Option<&'static str> {
    if c.deleted != 0 {
        return Some("deleted");
    }
    let flags = c.flags as u64;
    if flags & FLAG_DELETED != 0 {
        return Some("flags_deleted");
    }
    if flags & FLAG_DRAFT != 0 {
        return Some("flags_draft");
    }
    if flags & FLAG_JUNK != 0 && flags & FLAG_NOT_JUNK == 0 {
        return Some("flags_junk");
    }
    None
}

/// Returns a static reason if this row should not be indexed (deleted / junk / draft from flags or columns).
#[must_use]
pub fn envelope_row_skip_reason(row: &EnvelopeMessageRow) -> Option<&'static str> {
    if matches!(column_truthy_int(row, "deleted"), Some(1)) {
        return Some("deleted");
    }
    if matches!(column_truthy_int(row, "junk"), Some(1)) {
        return Some("junk_column");
    }
    if matches!(column_truthy_int(row, "draft"), Some(1)) {
        return Some("draft_column");
    }

    if let Some(flags) = column_u64(row, "flags") {
        if flags & FLAG_DELETED != 0 {
            return Some("flags_deleted");
        }
        if flags & FLAG_DRAFT != 0 {
            return Some("flags_draft");
        }
        // Explicit "not junk" wins over junk bit (user correction).
        if flags & FLAG_JUNK != 0 && flags & FLAG_NOT_JUNK == 0 {
            return Some("flags_junk");
        }
    }

    None
}

/// All `mailboxes.ROWID` whose URL should not be indexed (Drafts, Trash, Junk, etc.).
pub fn build_skip_mailbox_map(
    envelope: &Connection,
) -> rusqlite::Result<HashMap<i64, &'static str>> {
    let mut stmt = envelope.prepare("SELECT ROWID, url FROM mailboxes")?;
    let mut rows = stmt.query([])?;
    let mut out = HashMap::new();
    while let Some(row) = rows.next()? {
        let rowid: i64 = row.get(0)?;
        let url: String = row.get(1)?;
        if let Some(reason) = mailbox_url_skip_reason(&url) {
            out.insert(rowid, reason);
        }
    }
    Ok(out)
}

fn normalize_mailbox_folder_path(url: &str) -> String {
    let lower = url.trim().to_ascii_lowercase();
    let after_scheme = if let Some(rest) = lower.strip_prefix("imap://") {
        if let Some((_, path)) = rest.split_once('/') {
            path
        } else {
            ""
        }
    } else if let Some(rest) = lower.strip_prefix("file://") {
        rest.strip_prefix("localhost").unwrap_or(rest)
    } else {
        return String::new();
    };
    urlencoding::decode(after_scheme)
        .map(|c| c.to_lowercase())
        .unwrap_or_else(|_| after_scheme.to_string())
}

/// Returns a static reason if the mailbox URL points at Drafts / Junk / Trash / Spam / Deleted, etc.
#[must_use]
pub fn mailbox_url_skip_reason(url: &str) -> Option<&'static str> {
    let path = normalize_mailbox_folder_path(url);
    if path.is_empty() {
        return None;
    }

    for raw_seg in path.split('/') {
        let seg = raw_seg.trim();
        if seg.is_empty() {
            continue;
        }
        let seg = seg.strip_suffix(".mbox").unwrap_or(seg);
        match seg {
            "drafts" | "trash" | "junk" | "spam" | "bin" | "deleted messages" | "junk e-mail"
            | "bulk mail" => return Some("mailbox_special_folder"),
            _ => {}
        }
    }

    // Substring pass for paths that encode oddly or use non-segment boundaries.
    if path.contains("/drafts")
        || path.contains("/trash")
        || path.contains("/junk")
        || path.contains("/spam")
        || path.contains("deleted messages")
        || path.contains("[gmail]/drafts")
        || path.contains("[gmail]/spam")
        || path.contains("[gmail]/trash")
    {
        return Some("mailbox_path_heuristic");
    }

    None
}

/// Cached `SELECT url FROM mailboxes WHERE ROWID = ?`.
pub fn mailbox_url_cached(
    envelope: &Connection,
    mailbox_rowid: i64,
    cache: &mut HashMap<i64, Option<String>>,
) -> Option<String> {
    if let Some(c) = cache.get(&mailbox_rowid) {
        return c.clone();
    }
    let url: Option<String> = envelope
        .query_row(
            "SELECT url FROM mailboxes WHERE ROWID = ?1",
            [mailbox_rowid],
            |r| r.get(0),
        )
        .ok();
    cache.insert(mailbox_rowid, url.clone());
    url
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use rusqlite::Connection;

    fn row_with_cols(cols: &[(&str, &str)]) -> EnvelopeMessageRow {
        let mut columns = HashMap::new();
        for (k, v) in cols {
            columns.insert((*k).to_string(), (*v).to_string());
        }
        EnvelopeMessageRow {
            rowid: 1,
            mailbox_rowid: None,
            remote_id: None,
            date_received: None,
            date_sent: None,
            columns,
        }
    }

    #[test]
    fn skip_deleted_column() {
        let r = row_with_cols(&[("deleted", "1")]);
        assert_eq!(envelope_row_skip_reason(&r), Some("deleted"));
    }

    #[test]
    fn skip_flags_junk_and_draft() {
        let flags_junk = format!("{}", FLAG_JUNK);
        let junk = row_with_cols(&[("flags", flags_junk.as_str())]);
        assert_eq!(envelope_row_skip_reason(&junk), Some("flags_junk"));

        let mut not_junk_cols = HashMap::new();
        not_junk_cols.insert(
            "flags".to_string(),
            format!("{}", FLAG_JUNK | FLAG_NOT_JUNK),
        );
        let not_junk = EnvelopeMessageRow {
            rowid: 1,
            mailbox_rowid: None,
            remote_id: None,
            date_received: None,
            date_sent: None,
            columns: not_junk_cols,
        };
        assert_eq!(envelope_row_skip_reason(&not_junk), None);

        let flags_draft = format!("{}", FLAG_DRAFT);
        let draft = row_with_cols(&[("flags", flags_draft.as_str())]);
        assert_eq!(envelope_row_skip_reason(&draft), Some("flags_draft"));
    }

    #[test]
    fn mailbox_url_skips_special_folders() {
        assert_eq!(
            mailbox_url_skip_reason("imap://acc-uuid/Drafts"),
            Some("mailbox_special_folder")
        );
        assert_eq!(mailbox_url_skip_reason("imap://acc-uuid/INBOX"), None);
        assert_eq!(
            mailbox_url_skip_reason("imap://acc-uuid/%5BGmail%5D/Spam"),
            Some("mailbox_special_folder")
        );
    }

    #[test]
    fn mailbox_url_cached_queries_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE mailboxes (url TEXT);
             INSERT INTO mailboxes VALUES ('imap://u/Drafts');",
        )
        .unwrap();
        let mut cache = HashMap::new();
        let u = mailbox_url_cached(&conn, 1, &mut cache).unwrap();
        assert!(u.contains("Drafts"));
        let u2 = mailbox_url_cached(&conn, 1, &mut cache).unwrap();
        assert_eq!(u, u2);
    }

    #[test]
    fn build_skip_mailbox_map_marks_drafts() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE mailboxes (url TEXT);
             INSERT INTO mailboxes VALUES ('imap://u/INBOX');
             INSERT INTO mailboxes VALUES ('imap://u/Drafts');",
        )
        .unwrap();
        let m = build_skip_mailbox_map(&conn).unwrap();
        assert!(!m.contains_key(&1));
        assert!(m.contains_key(&2));
    }
}
