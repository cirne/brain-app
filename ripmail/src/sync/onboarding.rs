//! First-time mailbox backfill detection (OPP-041).

use rusqlite::{params, Connection, OptionalExtension};

use crate::config::ResolvedMailbox;

/// True when this mailbox should run a backward `--since`-style sync on plain `refresh`.
///
/// Predicate: valid IMAP credentials (or Apple Mail local root), no `first_backfill_completed_at` in `mailbox_sync_meta`,
/// and zero messages indexed for this mailbox. (Any indexed messages imply initialized.)
pub fn mailbox_needs_first_backfill(
    conn: &Connection,
    mb: &ResolvedMailbox,
) -> rusqlite::Result<bool> {
    if mb.apple_mail_root.is_some() {
        let ready = mb
            .apple_mail_root
            .as_ref()
            .map(|p| crate::applemail::envelope_index_path(p).is_file())
            .unwrap_or(false);
        if !ready {
            return Ok(false);
        }
    } else if mb.imap_user.trim().is_empty() || mb.imap_password.trim().is_empty() {
        return Ok(false);
    }
    if first_backfill_completed(conn, &mb.id)? {
        return Ok(false);
    }
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE mailbox_id = ?1",
        [&mb.id],
        |r| r.get(0),
    )?;
    Ok(count == 0)
}

pub fn first_backfill_completed(conn: &Connection, mailbox_id: &str) -> rusqlite::Result<bool> {
    let row: Option<String> = conn
        .query_row(
            "SELECT first_backfill_completed_at FROM mailbox_sync_meta WHERE mailbox_id = ?1",
            [mailbox_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(row.is_some())
}

/// Record that a backward init finished successfully for this mailbox (call even when zero messages
/// were stored, e.g. empty server or all labels excluded).
pub fn mark_first_backfill_completed(conn: &Connection, mailbox_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO mailbox_sync_meta (mailbox_id, first_backfill_completed_at) VALUES (?1, datetime('now')) \
         ON CONFLICT(mailbox_id) DO UPDATE SET first_backfill_completed_at = excluded.first_backfill_completed_at",
        params![mailbox_id],
    )?;
    Ok(())
}
