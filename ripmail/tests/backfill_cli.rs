//! CLI smoke tests for `ripmail backfill` / `ripmail refresh` split.

use std::process::Command;

#[test]
fn backfill_help_mentions_since() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .args(["backfill", "--help"])
        .output()
        .expect("spawn");
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("backfill"), "{s}");
    assert!(s.contains("--since") || s.contains("-s"), "{s}");
}

#[test]
fn refresh_help_has_no_since() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .args(["refresh", "--help"])
        .output()
        .expect("spawn");
    assert!(out.status.success());
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(
        !s.contains("--since"),
        "refresh should not expose --since: {s}"
    );
}
