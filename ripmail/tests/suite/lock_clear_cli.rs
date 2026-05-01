//! `ripmail lock clear` clears stale `sync_summary` locks (non-destructive when sync is live).

use std::process::Command;

use ripmail::open_file;
use tempfile::tempdir;

#[test]
fn lock_clear_clears_dead_pid_and_skips_live() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("ripmail.db");
    let conn = open_file(&db_path).expect("open db");
    conn
        .execute(
            "UPDATE sync_summary SET is_running = 1, owner_pid = 999999999, sync_lock_started_at = datetime('now') WHERE id = 1",
            [],
        )
        .expect("seed stale lock");
    drop(conn);

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let s = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["lock", "clear"])
        .status()
        .expect("spawn");
    assert!(s.success(), "lock clear should exit 0 for stale lock");

    let conn = open_file(&db_path).expect("reopen");
    let (running, pid): (i64, Option<i64>) = conn
        .query_row(
            "SELECT is_running, owner_pid FROM sync_summary WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("read row 1");
    assert_eq!(running, 0, "stale lock should be cleared");
    assert_eq!(pid, None);

    // Live PID = this test process: should not be cleared
    let live = std::process::id() as i64;
    conn
        .execute(
            "UPDATE sync_summary SET is_running = 1, owner_pid = ?1, sync_lock_started_at = datetime('now') WHERE id = 1",
            [live],
        )
        .expect("set live lock");
    drop(conn);

    let s2 = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["lock", "clear"])
        .status()
        .expect("spawn 2");
    assert!(s2.success());

    let conn = open_file(&db_path).expect("reopen 2");
    let (running2, pid2): (i64, Option<i64>) = conn
        .query_row(
            "SELECT is_running, owner_pid FROM sync_summary WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("read row 1 after live");
    assert_eq!(running2, 1, "live lock should remain");
    assert_eq!(pid2, Some(live));
}
