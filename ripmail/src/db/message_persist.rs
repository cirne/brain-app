//! Insert messages / threads / attachments (mirrors `src/db/message-persistence.ts`).

use std::collections::HashSet;
use std::path::Path;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, CachedStatement, Connection, Transaction};

use crate::mail_category::{is_default_excluded_category, label_to_category};
use crate::sync::ingest_date::apply_mailbox_index_date_normalization;
use crate::sync::{MailboxEntry, ParsedAttachment, ParsedMessage};

const SQL_INSERT_MESSAGE: &str = "INSERT INTO messages (
      message_id, thread_id, folder, uid, labels, category, from_address, from_name,
      to_addresses, cc_addresses, to_recipients, cc_recipients, subject, date, body_text, raw_path, source_id,
      is_reply, recipient_count, list_like
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)";

const SQL_INSERT_MESSAGE_OR_IGNORE: &str = "INSERT OR IGNORE INTO messages (
      message_id, thread_id, folder, uid, labels, category, from_address, from_name,
      to_addresses, cc_addresses, to_recipients, cc_recipients, subject, date, body_text, raw_path, source_id,
      is_reply, recipient_count, list_like
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)";

const SQL_UPSERT_THREAD: &str = "INSERT OR REPLACE INTO threads (thread_id, subject, participant_count, message_count, last_message_at)
     VALUES (?1, ?2, 1, 1, ?3)";

const SQL_INSERT_ATTACHMENT: &str =
    "INSERT INTO attachments (message_id, filename, mime_type, size, stored_path, extracted_text)
     VALUES (?1, ?2, ?3, ?4, ?5, NULL)";

fn mime_from_ext(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

fn label_category(labels_json: &str) -> Option<String> {
    let Ok(arr) = serde_json::from_str::<Vec<String>>(labels_json) else {
        return None;
    };
    arr.iter()
        .find_map(|label| label_to_category(label).map(str::to_string))
}

fn recipients_json_for_persist(parsed: &ParsedMessage) -> (String, String) {
    let to_rec: Vec<MailboxEntry> = if !parsed.to_recipients.is_empty() {
        parsed.to_recipients.clone()
    } else {
        parsed
            .to_addresses
            .iter()
            .map(|a| MailboxEntry {
                name: None,
                address: a.clone(),
            })
            .collect()
    };
    let cc_rec: Vec<MailboxEntry> = if !parsed.cc_recipients.is_empty() {
        parsed.cc_recipients.clone()
    } else {
        parsed
            .cc_addresses
            .iter()
            .map(|a| MailboxEntry {
                name: None,
                address: a.clone(),
            })
            .collect()
    };
    (
        serde_json::to_string(&to_rec).unwrap_or_else(|_| "[]".into()),
        serde_json::to_string(&cc_rec).unwrap_or_else(|_| "[]".into()),
    )
}

/// `true` when SQLite reports a UNIQUE / PRIMARY KEY constraint (duplicate `message_id`).
#[must_use]
pub fn is_sqlite_unique_violation(err: &rusqlite::Error) -> bool {
    match err {
        rusqlite::Error::SqliteFailure(ie, _) => {
            ie.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                || ie.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
        }
        _ => false,
    }
}

/// UIDs already present for this mailbox (for Apple Mail sync dedup before reading `.emlx`).
///
/// Batched `IN` with anonymous `?` placeholders: `source_id` first, then each uid (same order as
/// `WHERE source_id = ? AND uid IN (?,…)`). Do **not** use `prepare_cached` + `query_row` in a
/// loop here — that was observed to mis-report matches.
pub fn uids_already_indexed(
    conn: &Connection,
    source_id: &str,
    uids: &[i64],
) -> rusqlite::Result<HashSet<i64>> {
    if uids.is_empty() {
        return Ok(HashSet::new());
    }
    const CHUNK: usize = 400;
    let mut out = HashSet::new();
    for chunk in uids.chunks(CHUNK) {
        let in_ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("SELECT uid FROM messages WHERE source_id = ? AND uid IN ({in_ph})");
        let mut bind: Vec<Value> = vec![Value::Text(source_id.to_string())];
        for u in chunk {
            bind.push(Value::Integer(*u));
        }
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(params_from_iter(bind.iter()))?;
        while let Some(row) = rows.next()? {
            out.insert(row.get::<_, i64>(0)?);
        }
    }
    Ok(out)
}

fn message_insert_params(
    parsed: &ParsedMessage,
    labels: &str,
) -> (Option<String>, String, String, String, String) {
    let category = label_category(labels).or_else(|| parsed.category.clone());
    let to_json = serde_json::to_string(&parsed.to_addresses).unwrap_or_else(|_| "[]".into());
    let cc_json = serde_json::to_string(&parsed.cc_addresses).unwrap_or_else(|_| "[]".into());
    let (to_rec_json, cc_rec_json) = recipients_json_for_persist(parsed);
    (category, to_json, cc_json, to_rec_json, cc_rec_json)
}

fn list_like_for_store(parsed: &ParsedMessage, labels: &str) -> i64 {
    let merged_cat = label_category(labels).or_else(|| parsed.category.clone());
    if parsed.list_like || is_default_excluded_category(merged_cat.as_deref()) {
        1
    } else {
        0
    }
}

pub struct RebuildWriter<'conn> {
    insert_message: CachedStatement<'conn>,
    upsert_thread: CachedStatement<'conn>,
}

impl<'conn> RebuildWriter<'conn> {
    pub fn new(tx: &'conn Transaction<'conn>) -> rusqlite::Result<Self> {
        Ok(Self {
            insert_message: tx.prepare_cached(SQL_INSERT_MESSAGE_OR_IGNORE)?,
            upsert_thread: tx.prepare_cached(SQL_UPSERT_THREAD)?,
        })
    }

    /// Insert message + thread row. Returns true if a new message row was inserted.
    /// `imap_folder` is the IMAP folder name (e.g. `[Gmail]/All Mail`); `source_id` is the account slug.
    pub fn persist_message(
        &mut self,
        parsed: &ParsedMessage,
        imap_folder: &str,
        source_id: &str,
        uid: i64,
        labels: &str,
        raw_path: &str,
    ) -> rusqlite::Result<bool> {
        let (category, to_json, cc_json, to_rec_json, cc_rec_json) =
            message_insert_params(parsed, labels);
        let list_like = list_like_for_store(parsed, labels);
        let n = self.insert_message.execute(params![
            parsed.message_id,
            parsed.message_id,
            imap_folder,
            uid,
            labels,
            category,
            parsed.from_address,
            parsed.from_name,
            to_json,
            cc_json,
            to_rec_json,
            cc_rec_json,
            parsed.subject,
            parsed.date,
            parsed.body_text,
            raw_path,
            source_id,
            parsed.is_reply as i64,
            i64::from(parsed.recipient_count),
            list_like,
        ])?;
        if n == 0 {
            return Ok(false);
        }
        self.upsert_thread
            .execute(params![parsed.message_id, parsed.subject, parsed.date])?;
        Ok(true)
    }
}

/// Insert message + thread row. Returns `Ok(true)` if inserted, `Ok(false)` on duplicate `message_id`.
/// Other errors (schema, FTS trigger, etc.) propagate.
pub fn persist_message(
    conn: &Connection,
    parsed: &mut ParsedMessage,
    imap_folder: &str,
    source_id: &str,
    uid: i64,
    labels: &str,
    raw_path: &str,
) -> rusqlite::Result<bool> {
    if !apply_mailbox_index_date_normalization(conn, source_id, parsed, raw_path)? {
        return Ok(false);
    }
    let (category, to_json, cc_json, to_rec_json, cc_rec_json) =
        message_insert_params(parsed, labels);
    let list_like = list_like_for_store(parsed, labels);

    let res = conn.execute(
        SQL_INSERT_MESSAGE,
        params![
            parsed.message_id,
            parsed.message_id,
            imap_folder,
            uid,
            labels,
            category,
            parsed.from_address,
            parsed.from_name,
            to_json,
            cc_json,
            to_rec_json,
            cc_rec_json,
            parsed.subject,
            parsed.date,
            parsed.body_text,
            raw_path,
            source_id,
            parsed.is_reply as i64,
            i64::from(parsed.recipient_count),
            list_like,
        ],
    );
    match res {
        Ok(_) => {
            conn.execute(
                SQL_UPSERT_THREAD,
                params![parsed.message_id, parsed.subject, parsed.date],
            )?;
            Ok(true)
        }
        Err(e) if is_sqlite_unique_violation(&e) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Insert attachment metadata (`filename`, `mime_type`, `size`). Bytes stay in the raw `.eml`;
/// [`crate::attachments::read_attachment_bytes`] loads them on demand (`stored_path` empty).
pub fn persist_attachments_from_parsed(
    conn: &Connection,
    message_id: &str,
    attachments: &[ParsedAttachment],
    _maildir_path: &Path,
) -> rusqlite::Result<()> {
    if attachments.is_empty() {
        return Ok(());
    }
    for att in attachments {
        let ext = att.filename.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
        let mime = if !att.mime_type.is_empty() {
            att.mime_type.as_str()
        } else {
            mime_from_ext(ext)
        };
        conn.execute(
            SQL_INSERT_ATTACHMENT,
            params![message_id, att.filename.as_str(), mime, att.size as i64, "",],
        )?;
    }
    Ok(())
}

/// Simple FTS check: return count of rows matching FTS query.
pub fn fts_match_count(conn: &Connection, fts_query: &str) -> rusqlite::Result<i64> {
    let sql = "SELECT COUNT(*) FROM document_index_fts \
               JOIN document_index di ON di.id = document_index_fts.rowid \
               WHERE document_index_fts MATCH ?1 AND di.kind = 'mail'";
    conn.query_row(sql, [fts_query], |row| row.get(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;
    use crate::sync::ParsedMessage;

    #[test]
    fn label_category_maps_known_labels() {
        assert_eq!(
            label_category(r#"["Promotions"]"#),
            Some("promotional".into())
        );
        assert_eq!(label_category(r#"["\\Spam"]"#), Some("spam".into()));
        assert_eq!(label_category(r#"["Inbox"]"#), None);
    }

    #[test]
    fn persist_and_fts() {
        let conn = open_memory().unwrap();
        let mut p = ParsedMessage {
            message_id: "<t@1>".into(),
            from_address: "from@x.com".into(),
            from_name: None,
            to_addresses: vec!["to@y.com".into()],
            cc_addresses: vec![],
            to_recipients: vec![],
            cc_recipients: vec![],
            subject: "hello world".into(),
            date: "2026-01-01T00:00:00Z".into(),
            body_text: "body content here".into(),
            body_html: None,
            attachments: vec![],
            category: None,
            ..Default::default()
        };
        assert!(persist_message(&conn, &mut p, "INBOX", "test_mb", 1, "[]", "/tmp/x").unwrap());
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let fts = fts_match_count(&conn, "hello").unwrap();
        assert!(fts >= 1);
    }

    #[test]
    fn persist_duplicate_message_id_returns_false() {
        let conn = open_memory().unwrap();
        let mut p = ParsedMessage {
            message_id: "<dup@x>".into(),
            from_address: "a@b.com".into(),
            from_name: None,
            to_addresses: vec![],
            cc_addresses: vec![],
            to_recipients: vec![],
            cc_recipients: vec![],
            subject: "s".into(),
            date: "2026-01-01T00:00:00Z".into(),
            body_text: "b".into(),
            body_html: None,
            attachments: vec![],
            category: None,
            ..Default::default()
        };
        assert!(persist_message(&conn, &mut p, "Apple Mail", "mb", 1, "[]", "/a").unwrap());
        assert!(!persist_message(&conn, &mut p, "Apple Mail", "mb", 2, "[]", "/b").unwrap());
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn uids_already_indexed_batch() {
        let conn = open_memory().unwrap();
        let mut p = ParsedMessage {
            message_id: "<u1@x>".into(),
            from_address: "a@b.com".into(),
            from_name: None,
            to_addresses: vec![],
            cc_addresses: vec![],
            to_recipients: vec![],
            cc_recipients: vec![],
            subject: "s".into(),
            date: "2026-01-01T00:00:00Z".into(),
            body_text: "b".into(),
            body_html: None,
            attachments: vec![],
            category: None,
            ..Default::default()
        };
        persist_message(&conn, &mut p, "Apple Mail", "mb", 100, "[]", "/a").unwrap();
        let set = uids_already_indexed(&conn, "mb", &[100, 200, 300]).unwrap();
        assert_eq!(set.len(), 1);
        assert!(set.contains(&100));
    }
}
