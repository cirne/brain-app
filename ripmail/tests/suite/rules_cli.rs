use std::fs;
use std::process::Command;

use ripmail::{db, persist_message, ParsedMessage};
use tempfile::tempdir;

const MAILBOX: &str = "[Gmail]/All Mail";

#[test]
fn rules_add_persists_file_and_show_reads_it() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let add = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "add", "--action", "ignore", "--query", "linkedin"])
        .output()
        .unwrap();
    assert!(
        add.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&add.stderr)
    );
    let added: serde_json::Value = serde_json::from_slice(&add.stdout).unwrap();
    let id = added["rule"]["id"].as_str().unwrap();
    assert_eq!(added["preview"]["available"], true);
    assert_eq!(added["preview"]["candidatesScanned"], 0);
    assert!(added["preview"]["samples"].is_array());
    assert_eq!(added["rule"]["kind"], "search");
    assert_eq!(added["rule"]["query"], "linkedin");
    let hints = added["hints"].as_array().expect("hints after rules add");
    assert!(
        hints[0]
            .as_str()
            .is_some_and(|s| s.contains("inbox") && s.contains("--reapply")),
        "{hints:?}"
    );
    let rules_path = dir.path().join("rules.json");
    let raw = fs::read_to_string(&rules_path).unwrap();
    let file_json: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        file_json["rules"][0]["query"].as_str(),
        Some("linkedin"),
        "persisted rules should include query; got: {raw}"
    );

    let show = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "show", id])
        .output()
        .unwrap();
    assert!(
        show.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&show.stderr)
    );
    let shown: serde_json::Value = serde_json::from_slice(&show.stdout).unwrap();
    assert_eq!(shown["value"]["id"], id);
}

#[test]
fn rules_move_reorders_list() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let add1 = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "add", "--action", "ignore", "--query", "a\\.test"])
        .output()
        .unwrap();
    assert!(
        add1.status.success(),
        "{}",
        String::from_utf8_lossy(&add1.stderr)
    );
    let add2 = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "add", "--action", "ignore", "--query", "b\\.test"])
        .output()
        .unwrap();
    assert!(
        add2.status.success(),
        "{}",
        String::from_utf8_lossy(&add2.stderr)
    );
    let j1: serde_json::Value = serde_json::from_slice(&add1.stdout).unwrap();
    let id1 = j1["rule"]["id"].as_str().unwrap();
    let j2: serde_json::Value = serde_json::from_slice(&add2.stdout).unwrap();
    let id2 = j2["rule"]["id"].as_str().unwrap();
    let mv = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "move", id2, "--before", id1])
        .output()
        .unwrap();
    assert!(
        mv.status.success(),
        "{}",
        String::from_utf8_lossy(&mv.stderr)
    );
    let mv_json: serde_json::Value = serde_json::from_slice(&mv.stdout).unwrap();
    assert_eq!(mv_json["moved"].as_str().unwrap(), id2);
    assert!(mv_json["hints"].as_array().is_some());
    let order = mv_json["rules"].as_array().unwrap();
    assert!(order.len() >= 2);
    assert!(order
        .iter()
        .all(|r| r.get("id").is_some() && r.get("action").is_some()));
    let raw = fs::read_to_string(dir.path().join("rules.json")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let rules = parsed["rules"].as_array().unwrap();
    let idx1 = rules
        .iter()
        .position(|r| r["id"].as_str() == Some(id1))
        .unwrap();
    let idx2 = rules
        .iter()
        .position(|r| r["id"].as_str() == Some(id2))
        .unwrap();
    assert!(
        idx2 < idx1,
        "moved rule should appear before anchor; idx2={idx2} idx1={idx1}"
    );
}

#[test]
fn rules_add_requires_criteria() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "add", "--action", "ignore"])
        .output()
        .unwrap();
    assert!(
        !out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    );
    let lower = combined.to_ascii_lowercase();
    assert!(
        lower.contains("query")
            || lower.contains("--from")
            || lower.contains("at least one")
            || lower.contains("category"),
        "{combined}"
    );
}

#[test]
fn rules_add_from_without_query_persists() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args([
            "rules",
            "add",
            "--action",
            "ignore",
            "--from",
            "anthony.s@legacycapfunders.com",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let j: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        j["rule"]["fromAddress"].as_str(),
        Some("anthony.s@legacycapfunders.com")
    );
    assert_eq!(j["rule"]["query"].as_str(), Some(""));
}

#[test]
fn rules_feedback_returns_structured_proposal() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "feedback", "too many shipping notifications"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["proposed"]["action"], "ignore");
    assert!(v["apply"].as_str().unwrap().contains("ripmail rules add"));
}

#[test]
fn rules_edit_returns_preview_payload() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let add = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args([
            "rules",
            "add",
            "--action",
            "ignore",
            "--query",
            "example\\.com",
        ])
        .output()
        .unwrap();
    assert!(
        add.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&add.stderr)
    );
    let added: serde_json::Value = serde_json::from_slice(&add.stdout).unwrap();
    let id = added["rule"]["id"].as_str().unwrap();

    let edit = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "edit", id, "--action", "ignore"])
        .output()
        .unwrap();
    assert!(
        edit.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&edit.stderr)
    );
    let edited: serde_json::Value = serde_json::from_slice(&edit.stdout).unwrap();
    assert_eq!(edited["rule"]["id"], id);
    assert_eq!(edited["rule"]["action"], "ignore");
    assert_eq!(edited["preview"]["available"], true);
    assert_eq!(edited["preview"]["candidatesScanned"], 0);
    assert_eq!(edited["preview"]["effectiveMatchedCount"], 0);
    assert_eq!(edited["preview"]["supersededMatchCount"], 0);
}

#[test]
fn archive_cli_sets_is_archived_json() {
    let dir = tempdir().unwrap();
    let conn = db::open_file(&dir.path().join("data/ripmail.db")).unwrap();
    let mut parsed = ParsedMessage {
        message_id: "<archive-cli@test>".into(),
        from_address: "a@b.com".into(),
        from_name: None,
        to_addresses: vec![],
        cc_addresses: vec![],
        to_recipients: vec![],
        cc_recipients: vec![],
        subject: "hi".into(),
        date: "2026-01-01T00:00:00Z".into(),
        body_text: "body".into(),
        body_html: None,
        attachments: vec![],
        category: None,
        ..Default::default()
    };
    persist_message(&conn, &mut parsed, MAILBOX, "", 1, "[]", "cur/x.eml").unwrap();
    drop(conn);

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["archive", "<archive-cli@test>"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["results"][0]["local"]["ok"], true);
    assert_eq!(v["results"][0]["local"]["isArchived"], true);
    assert_eq!(v["results"][0]["providerMutation"]["attempted"], false);

    let conn = db::open_file(&dir.path().join("data/ripmail.db")).unwrap();
    let archived: i64 = conn
        .query_row(
            "SELECT is_archived FROM messages WHERE message_id = '<archive-cli@test>'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(archived, 1);
}

/// When `mailboxManagement.enabled` is true but `allow` omits `archive`, `ripmail archive` must
/// not attempt IMAP (`providerMutation.attempted` false). Regression guard for opt-in write scope.
#[test]
fn archive_cli_skips_provider_when_mailbox_management_allow_excludes_archive() {
    let dir = tempdir().unwrap();
    let mailbox_id = "mm_allow_test_example_com";
    let config = serde_json::json!({
        "sources": [{
            "id": mailbox_id,
            "kind": "imap",
            "email": "mm-allow-test@example.com",
            "imapAuth": "googleOAuth",
            "imap": { "host": "imap.gmail.com", "port": 993 }
        }],
        "mailboxManagement": {
            "enabled": true,
            "allow": ["read", "sync"]
        }
    });
    fs::write(
        dir.path().join("config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();

    let db_path = dir.path().join("ripmail.db");
    let conn = db::open_file(&db_path).unwrap();
    let mut parsed = ParsedMessage {
        message_id: "<archive-allow-exclude@test>".into(),
        from_address: "a@b.com".into(),
        from_name: None,
        to_addresses: vec![],
        cc_addresses: vec![],
        to_recipients: vec![],
        cc_recipients: vec![],
        subject: "hi".into(),
        date: "2026-01-01T00:00:00Z".into(),
        body_text: "body".into(),
        body_html: None,
        attachments: vec![],
        category: None,
        ..Default::default()
    };
    persist_message(
        &conn,
        &mut parsed,
        MAILBOX,
        mailbox_id,
        1,
        r#"["\\Inbox"]"#,
        "cur/x.eml",
    )
    .unwrap();
    drop(conn);

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["archive", "<archive-allow-exclude@test>"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["results"][0]["local"]["ok"], true);
    assert_eq!(v["results"][0]["local"]["isArchived"], true);
    assert_eq!(v["results"][0]["providerMutation"]["attempted"], false);
    assert_eq!(v["results"][0]["providerMutation"]["ok"], false);
}

#[test]
fn rules_validate_fails_on_legacy_v1_until_reset() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("rules.json"),
        r#"{"version":1,"rules":[{"id":"a","condition":"x","action":"ignore"}],"context":[]}"#,
    )
    .unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "validate"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    let reset = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "reset-defaults", "--yes"])
        .output()
        .unwrap();
    assert!(reset.status.success());
    let ok = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "validate"])
        .output()
        .unwrap();
    assert!(ok.status.success());
}

#[test]
fn rules_reset_defaults_yes_recovers_from_corrupt_rules_file() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("rules.json"),
        "{\"version\":3,\"rules\":[\n",
    )
    .unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    assert!(!Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "validate"])
        .output()
        .unwrap()
        .status
        .success());
    let reset = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "reset-defaults", "--yes"])
        .output()
        .unwrap();
    assert!(
        reset.status.success(),
        "{}",
        String::from_utf8_lossy(&reset.stderr)
    );
    let val = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["rules", "validate"])
        .output()
        .unwrap();
    assert!(
        val.status.success(),
        "{}",
        String::from_utf8_lossy(&val.stderr)
    );
}

#[test]
fn inbox_help_exposes_expected_flags() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["inbox", "--help"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("--thorough"));
    assert!(stdout.contains("--reapply"));
    assert!(stdout.contains("--diagnostics"));
    assert!(stdout.contains("--text"));
    assert!(!stdout.contains("--no-update"));
    assert!(!stdout.contains("--urgent-only"));
    assert!(!stdout.contains("--replay"));
    assert!(!stdout.contains("--reclassify"));
}
