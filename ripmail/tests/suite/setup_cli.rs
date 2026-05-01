//! `ripmail setup` CLI when required credentials are missing (non-interactive guidance).

use std::fs;
use std::process::Command;

use tempfile::tempdir;

#[test]
fn setup_without_email_exits_zero_with_usage() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .env_remove("RIPMAIL_EMAIL")
        .env_remove("RIPMAIL_IMAP_PASSWORD")
        .arg("setup")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stderr.contains("account email required"),
        "stderr was: {stderr}"
    );
    assert!(
        stdout.contains("Usage: ripmail setup"),
        "stdout was: {stdout}"
    );
    assert!(stdout.contains("ripmail wizard"), "stdout was: {stdout}");
}

#[test]
fn setup_without_password_exits_zero_with_usage() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .env_remove("RIPMAIL_IMAP_PASSWORD")
        .arg("setup")
        .arg("--email")
        .arg("setup-cli-test@example.com")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stderr.contains("IMAP password required"),
        "stderr was: {stderr}"
    );
    assert!(
        stdout.contains("Usage: ripmail setup"),
        "stdout was: {stdout}"
    );
}

#[test]
fn config_mailbox_management_flag_writes_config() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .env("RIPMAIL_EMAIL", "mm-test@example.com")
        .env("RIPMAIL_IMAP_PASSWORD", "testpass")
        .arg("setup")
        .arg("--no-validate")
        .arg("--no-skill")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["config", "--mailbox-management", "on"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        v["mailboxManagement"]["enabled"], true,
        "config.json: {raw}"
    );
}

#[test]
fn config_mailbox_management_merge_without_credentials() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("config.json"),
        r#"{"sync":{"defaultSince":"1y"}}"#,
    )
    .unwrap();

    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .env_remove("RIPMAIL_EMAIL")
        .env_remove("RIPMAIL_IMAP_PASSWORD")
        .args(["config", "--mailbox-management", "on"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["mailboxManagement"]["enabled"], true, "config: {raw}");
    assert_eq!(
        v["sync"]["defaultSince"].as_str(),
        Some("1y"),
        "merge should preserve other keys: {raw}"
    );

    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["config", "--mailbox-management", "off"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["mailboxManagement"]["enabled"], false, "config: {raw}");
}

#[test]
fn config_mailbox_management_merge_errors_without_config() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["config", "--mailbox-management", "on"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("no config") || stderr.contains("Run"),
        "stderr: {stderr}"
    );
}

#[test]
fn setup_without_mailbox_management_flag_does_not_write_it() {
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let dir = tempdir().unwrap();
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .env("RIPMAIL_EMAIL", "no-mm@example.com")
        .env("RIPMAIL_IMAP_PASSWORD", "testpass")
        .arg("setup")
        .arg("--no-validate")
        .arg("--no-skill")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    // Without the flag, mailboxManagement should be absent from config
    assert!(
        v["mailboxManagement"].is_null(),
        "Expected no mailboxManagement key, got: {raw}"
    );
}
