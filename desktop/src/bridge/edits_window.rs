use std::path::Path;

use rusqlite::{params, OpenFlags};

use crate::bridge::imessage::{
    apple_date_ns_to_unix_ms, extract_text_from_attributed_body, unix_ms_to_apple_date_ns,
    ImessageRow,
};
use crate::bridge::BridgeResult;

pub fn fetch_recent_window(path: &Path, days: i64, limit: usize) -> BridgeResult<Vec<ImessageRow>> {
    let conn = rusqlite::Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time")
        .as_millis() as i64;
    let window_ms = now_ms - (days.max(1) * 24 * 60 * 60 * 1000);
    let cutoff_ns = unix_ms_to_apple_date_ns(window_ms);
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
        WHERE m.date >= ?1
        ORDER BY m.date DESC
        LIMIT ?2
        "#,
    )?;

    let mut out = Vec::new();
    let rows = stmt.query_map(params![cutoff_ns, capped], |row| {
        let text: Option<String> = row.get("text")?;
        let attr: Option<Vec<u8>> = row.get("attributedBody")?;
        let resolved = if let Some(t) = text {
            if t.is_empty() || t == "\u{fffc}" {
                attr.as_deref().and_then(extract_text_from_attributed_body)
            } else {
                Some(t)
            }
        } else {
            attr.as_deref().and_then(extract_text_from_attributed_body)
        };
        Ok(ImessageRow {
            rowid: row.get("rowid")?,
            guid: row.get("guid")?,
            date_ms: apple_date_ns_to_unix_ms(row.get("date_ns")?),
            text: resolved,
            is_from_me: row.get::<_, i64>("is_from_me")? != 0,
            handle: row.get("handle")?,
            chat_identifier: row.get("chat_identifier")?,
            display_name: row.get("display_name")?,
            service: row
                .get::<_, Option<String>>("service")?
                .unwrap_or_else(|| "iMessage".to_string()),
        })
    })?;
    for r in rows {
        out.push(r?);
    }
    out.reverse();
    Ok(out)
}
