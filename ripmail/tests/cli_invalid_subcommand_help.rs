//! Unrecognized subcommand prints long help for the appropriate parent command.

use tempfile::tempdir;

#[test]
fn bare_ripmail_exits_zero() {
    let tmp = tempdir().expect("tempdir");
    std::fs::write(
        tmp.path().join("config.json"),
        r#"{"imap":{"user":"configured@example.com"}}"#,
    )
    .expect("write config");
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = std::process::Command::new(bin)
        .env("RIPMAIL_HOME", tmp.path())
        .output()
        .expect("spawn ripmail");
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Usage:") && stdout.contains("ripmail"),
        "expected help on stdout, got: {stdout:?}"
    );
}

#[test]
fn bare_ripmail_migrates_legacy_zmail_home() {
    let tmp = tempdir().expect("tempdir");
    let user_home = tmp.path();
    let legacy = user_home.join(".zmail");
    std::fs::create_dir_all(&legacy).expect("mkdir .zmail");
    std::fs::write(
        legacy.join("config.json"),
        r#"{"imap":{"user":"configured@example.com"}}"#,
    )
    .expect("write config");
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let mut cmd = std::process::Command::new(bin);
    cmd.env("HOME", user_home)
        .env("USERPROFILE", user_home)
        .env_remove("RIPMAIL_HOME");
    let out = cmd.output().expect("spawn ripmail");
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        user_home.join(".ripmail").join("config.json").is_file(),
        "expected migrated config under .ripmail"
    );
    assert!(
        !user_home.join(".zmail").exists(),
        "expected .zmail renamed away"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Usage:") && stdout.contains("ripmail search"),
        "expected root long help after migration, got: {stdout:?}"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("renamed") && stderr.contains("zmail"),
        "expected migration note on stderr, got: {stderr:?}"
    );
}

#[test]
fn bare_ripmail_with_empty_ripmail_home_prints_first_run_hint() {
    let tmp = tempdir().expect("tempdir");
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = std::process::Command::new(bin)
        .env("RIPMAIL_HOME", tmp.path())
        .output()
        .expect("spawn ripmail");
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("No config yet") && stdout.contains("ripmail wizard"),
        "expected first-run help on stdout, got: {stdout:?}"
    );
    assert!(
        !stdout.contains("ripmail search"),
        "no-config bare ripmail must not print root command list: {stdout:?}"
    );
}

#[test]
fn unrecognized_top_level_subcommand_prints_root_long_help() {
    let tmp = tempdir().expect("tempdir");
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = std::process::Command::new(bin)
        .env("RIPMAIL_HOME", tmp.path())
        .arg("not-a-real-ripmail-cmd")
        .output()
        .expect("spawn ripmail");
    assert_eq!(
        out.status.code(),
        Some(2),
        "stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("ripmail search"),
        "expected root long help on stdout, got: {stdout:?}"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("unrecognized subcommand"),
        "expected error on stderr, got: {stderr:?}"
    );
}

#[test]
fn unrecognized_nested_subcommand_prints_parent_long_help() {
    let tmp = tempdir().expect("tempdir");
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = std::process::Command::new(bin)
        .env("RIPMAIL_HOME", tmp.path())
        .args(["draft", "not-a-draft-subcmd"])
        .output()
        .expect("spawn ripmail");
    assert_eq!(out.status.code(), Some(2));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Local drafts") && stdout.contains("list"),
        "expected draft long help on stdout, got: {stdout:?}"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("unrecognized subcommand"),
        "stderr={stderr:?}"
    );
}
