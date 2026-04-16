//! `ripmail clean` — preview vs destructive reset.

use std::fs;
use std::process::Command;

use tempfile::tempdir;

#[test]
fn clean_preview_without_yes_shows_tip() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("config.json"),
        r#"{"sync":{"defaultSince":"1y"}}"#,
    )
    .unwrap();

    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["clean"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("ripmail clean --yes"), "stdout: {stdout}");
    assert!(
        stdout.contains("Ripmail directory (RIPMAIL_HOME):"),
        "stdout: {stdout}"
    );
    assert!(stdout.contains("Top-level paths"), "stdout: {stdout}");
    assert!(dir.path().join("config.json").exists());
}

#[test]
fn clean_with_yes_removes_top_level() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("config.json"),
        r#"{"sync":{"defaultSince":"1y"}}"#,
    )
    .unwrap();

    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["clean", "--yes"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Removed all ripmail data"),
        "stdout: {stdout}"
    );
    assert!(!dir.path().join("config.json").exists());
}

#[test]
fn clean_empty_home_reports_nothing() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();

    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["clean"])
        .output()
        .unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("empty"), "stdout: {stdout}");
}
