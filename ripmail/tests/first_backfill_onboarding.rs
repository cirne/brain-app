//! OPP-041: first-backfill predicate and meta table.

use ripmail::{
    apply_schema, mailbox_needs_first_backfill, mark_first_backfill_completed, open_file,
    MailboxImapAuthKind, ResolvedMailbox,
};
use rusqlite::Connection;
use std::path::PathBuf;
use tempfile::tempdir;

fn test_mb(id: &str) -> ResolvedMailbox {
    ResolvedMailbox {
        id: id.into(),
        email: format!("{id}@test.example"),
        imap_host: "imap.test".into(),
        imap_port: 993,
        imap_user: format!("{id}@test.example"),
        imap_aliases: vec![],
        imap_password: "secret".into(),
        imap_auth: MailboxImapAuthKind::AppPassword,
        include_in_default: true,
        maildir_path: PathBuf::from("/tmp"),
        apple_mail_root: None,
    }
}

fn open_temp_db(dir: &std::path::Path) -> Connection {
    let p = dir.join("data");
    std::fs::create_dir_all(&p).unwrap();
    let db_path = p.join("ripmail.db");
    let conn = open_file(&db_path).unwrap();
    apply_schema(&conn).unwrap();
    conn
        .execute(
            "UPDATE sync_summary SET is_running = 0, owner_pid = NULL, sync_lock_started_at = NULL WHERE id = 1",
            [],
        )
        .ok();
    conn
}

#[test]
fn needs_first_backfill_true_when_empty_and_not_marked() {
    let dir = tempdir().unwrap();
    let conn = open_temp_db(dir.path());
    let mb = test_mb("mb1");
    assert!(mailbox_needs_first_backfill(&conn, &mb).unwrap());
}

#[test]
fn needs_first_backfill_false_after_mark() {
    let dir = tempdir().unwrap();
    let conn = open_temp_db(dir.path());
    let mb = test_mb("mb1");
    mark_first_backfill_completed(&conn, &mb.id).unwrap();
    assert!(!mailbox_needs_first_backfill(&conn, &mb).unwrap());
}

#[test]
fn needs_first_backfill_false_when_messages_exist_without_meta() {
    let dir = tempdir().unwrap();
    let conn = open_temp_db(dir.path());
    let mb = test_mb("mb1");
    conn.execute(
        "INSERT INTO messages (message_id, thread_id, folder, uid, labels, from_address, date, body_text, raw_path, mailbox_id) VALUES (?1, 't', 'INBOX', 1, '[]', 'a@b', '2024-01-01', '', 'x', ?2)",
        rusqlite::params!["<m1@test>", mb.id],
    )
    .unwrap();
    assert!(!mailbox_needs_first_backfill(&conn, &mb).unwrap());
}

#[test]
fn needs_first_backfill_false_without_credentials() {
    let dir = tempdir().unwrap();
    let conn = open_temp_db(dir.path());
    let mut mb = test_mb("mb1");
    mb.imap_password = String::new();
    assert!(!mailbox_needs_first_backfill(&conn, &mb).unwrap());
}
