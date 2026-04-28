use std::path::Path;

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::bridge::BridgeResult;

const APPLE_EPOCH_UNIX_MS: i64 = 978_307_200_000;
const ATTRIBUTED_BODY_MARKER: [u8; 2] = [0x01, 0x2B];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImessageRow {
    pub rowid: i64,
    pub guid: String,
    pub date_ms: i64,
    pub text: Option<String>,
    pub is_from_me: bool,
    pub handle: Option<String>,
    pub chat_identifier: Option<String>,
    pub display_name: Option<String>,
    pub service: String,
}

#[derive(Debug)]
struct RawImessageRow {
    rowid: i64,
    guid: String,
    text: Option<String>,
    attributed_body: Option<Vec<u8>>,
    date_ns: i64,
    is_from_me: i64,
    handle: Option<String>,
    chat_identifier: Option<String>,
    display_name: Option<String>,
    service: Option<String>,
}

pub fn apple_date_ns_to_unix_ms(ns: i64) -> i64 {
    APPLE_EPOCH_UNIX_MS + ns / 1_000_000
}

pub fn unix_ms_to_apple_date_ns(ms: i64) -> i64 {
    (ms - APPLE_EPOCH_UNIX_MS) * 1_000_000
}

pub fn extract_text_from_attributed_body(blob: &[u8]) -> Option<String> {
    let marker_pos = blob
        .windows(ATTRIBUTED_BODY_MARKER.len())
        .position(|w| w == ATTRIBUTED_BODY_MARKER)?;
    let len_offset = marker_pos + ATTRIBUTED_BODY_MARKER.len();
    if len_offset >= blob.len() {
        return None;
    }
    let mut len = blob[len_offset] as usize;
    let mut start = len_offset + 1;
    if len >= 128 {
        if start >= blob.len() {
            return None;
        }
        len = (len & 0x7f) | ((blob[start] as usize) << 7);
        start += 1;
    }
    let end = start.checked_add(len)?;
    if end > blob.len() {
        return None;
    }
    let txt = String::from_utf8_lossy(&blob[start..end]).replace('\0', "");
    if txt.is_empty() {
        None
    } else {
        Some(txt)
    }
}

fn resolve_message_text(raw: &RawImessageRow) -> Option<String> {
    if let Some(t) = raw.text.as_ref() {
        if !t.is_empty() && t != "\u{fffc}" {
            return Some(t.clone());
        }
    }
    raw.attributed_body
        .as_ref()
        .and_then(|blob| extract_text_from_attributed_body(blob))
}

pub fn open_readonly(path: &Path) -> BridgeResult<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?)
}

pub fn fetch_since(path: &Path, last_rowid: i64, limit: usize) -> BridgeResult<Vec<ImessageRow>> {
    let conn = open_readonly(path)?;
    let capped = limit.clamp(1, 5_000) as i64;
    let mut stmt = conn.prepare(
        r#"
        SELECT
          m.ROWID AS rowid,
          m.guid AS guid,
          m.text AS text,
          m.attributedBody AS attributedBody,
          m.date AS date_ns,
          m.is_from_me AS is_from_me,
          h.id AS handle,
          c.chat_identifier AS chat_identifier,
          c.display_name AS display_name,
          m.service AS service
        FROM message m
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.ROWID > ?1
        ORDER BY m.ROWID ASC
        LIMIT ?2
        "#,
    )?;

    let rows = stmt.query_map(params![last_rowid, capped], |row| {
        Ok(RawImessageRow {
            rowid: row.get("rowid")?,
            guid: row.get("guid")?,
            text: row.get("text")?,
            attributed_body: row.get("attributedBody")?,
            date_ns: row.get("date_ns")?,
            is_from_me: row.get("is_from_me")?,
            handle: row.get("handle")?,
            chat_identifier: row.get("chat_identifier")?,
            display_name: row.get("display_name")?,
            service: row.get("service")?,
        })
    })?;

    let mut out = Vec::new();
    for raw in rows {
        let raw = raw?;
        let resolved_text = resolve_message_text(&raw);
        out.push(ImessageRow {
            rowid: raw.rowid,
            guid: raw.guid,
            date_ms: apple_date_ns_to_unix_ms(raw.date_ns),
            text: resolved_text,
            is_from_me: raw.is_from_me != 0,
            handle: raw.handle,
            chat_identifier: raw.chat_identifier,
            display_name: raw.display_name,
            service: raw.service.unwrap_or_else(|| "iMessage".to_string()),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("bridge-imessage-{name}-{nonce}.db"))
    }

    fn seed_db(path: &Path) {
        let conn = Connection::open(path).expect("open");
        conn.execute_batch(
            r#"
            CREATE TABLE message (
              ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
              guid TEXT UNIQUE NOT NULL,
              text TEXT,
              attributedBody BLOB,
              date INTEGER,
              is_from_me INTEGER DEFAULT 0,
              handle_id INTEGER DEFAULT 0,
              service TEXT
            );
            CREATE TABLE handle (
              ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
              id TEXT
            );
            CREATE TABLE chat (
              ROWID INTEGER PRIMARY KEY AUTOINCREMENT,
              guid TEXT UNIQUE NOT NULL,
              chat_identifier TEXT,
              display_name TEXT
            );
            CREATE TABLE chat_message_join (
              chat_id INTEGER,
              message_id INTEGER,
              message_date INTEGER DEFAULT 0,
              index_state INTEGER NOT NULL DEFAULT 2,
              PRIMARY KEY (chat_id, message_id)
            );
            "#,
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO handle (id) VALUES (?1)",
            params!["+15550001111"],
        )
        .expect("handle");
        conn.execute(
            "INSERT INTO chat (guid, chat_identifier, display_name) VALUES (?1, ?2, ?3)",
            params!["chat-guid-1", "+15550001111", "Alice"],
        )
        .expect("chat");

        let d1 = unix_ms_to_apple_date_ns(1_714_000_000_000);
        let d2 = unix_ms_to_apple_date_ns(1_714_000_060_000);
        conn.execute(
            "INSERT INTO message (guid, text, date, is_from_me, handle_id, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg-1", "Hello", d1, 0, 1, "iMessage"],
        )
        .expect("m1");
        conn.execute(
            "INSERT INTO message (guid, text, date, is_from_me, handle_id, service) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["msg-2", "Reply", d2, 1, 1, "iMessage"],
        )
        .expect("m2");
        conn.execute(
            "INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?1, ?2, ?3)",
            params![1, 1, d1],
        )
        .expect("cmj1");
        conn.execute(
            "INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?1, ?2, ?3)",
            params![1, 2, d2],
        )
        .expect("cmj2");
    }

    #[test]
    fn extracts_attributed_body_text() {
        let mut blob = Vec::new();
        blob.extend_from_slice(b"junk");
        blob.extend_from_slice(&ATTRIBUTED_BODY_MARKER);
        blob.push(5);
        blob.extend_from_slice(b"hello");
        assert_eq!(
            extract_text_from_attributed_body(&blob),
            Some("hello".to_string())
        );
    }

    #[test]
    fn fetch_since_returns_ordered_rows() {
        let path = temp_db_path("fetch");
        seed_db(&path);
        let rows = fetch_since(&path, 0, 100).expect("fetch");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].guid, "msg-1");
        assert_eq!(rows[0].text.as_deref(), Some("Hello"));
        assert_eq!(rows[1].guid, "msg-2");
        let _ = fs::remove_file(path);
    }
}
