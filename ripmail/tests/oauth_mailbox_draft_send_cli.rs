//! BUG-040: OAuth mailbox — `draft new` and `send --dry-run` must not require IMAP app password.

use std::fs;
use std::process::Command;

use tempfile::tempdir;

fn write_oauth_mailbox_home(home: &std::path::Path, with_token_file: bool) {
    fs::create_dir_all(home.join("data").join("drafts")).unwrap();
    let mailbox_id = "oauthuser_example_com";
    let config = serde_json::json!({
        "sources": [{
            "id": mailbox_id,
            "kind": "imap",
            "email": "oauthuser@example.com",
            "imapAuth": "googleOAuth",
            "imap": { "host": "imap.gmail.com", "port": 993 }
        }]
    });
    fs::write(
        home.join("config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();
    if with_token_file {
        fs::create_dir_all(home.join(mailbox_id)).unwrap();
        fs::write(
            home.join(mailbox_id).join("google-oauth.json"),
            r#"{"refreshToken":"test-refresh"}"#,
        )
        .unwrap();
    }
}

#[test]
fn draft_new_succeeds_for_oauth_mailbox_without_app_password() {
    let tmp = tempdir().unwrap();
    write_oauth_mailbox_home(tmp.path(), false);
    let st = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", tmp.path())
        .env_remove("RIPMAIL_IMAP_PASSWORD")
        .args([
            "draft",
            "new",
            "--to",
            "a@b.com",
            "--subject",
            "S",
            "--body",
            "Hi",
            "--text",
        ])
        .status()
        .expect("spawn ripmail");
    assert!(
        st.success(),
        "draft new should succeed for OAuth mailbox without app password"
    );
}

#[test]
fn send_dry_run_succeeds_for_oauth_mailbox_with_token_file() {
    let tmp = tempdir().unwrap();
    write_oauth_mailbox_home(tmp.path(), true);
    let st = Command::new(env!("CARGO_BIN_EXE_ripmail"))
        .env("RIPMAIL_HOME", tmp.path())
        .env_remove("RIPMAIL_IMAP_PASSWORD")
        .args([
            "send",
            "--to",
            "a@b.com",
            "--subject",
            "S",
            "--body",
            "Hi",
            "--dry-run",
        ])
        .status()
        .expect("spawn ripmail");
    assert!(
        st.success(),
        "send --dry-run should succeed for OAuth mailbox with google-oauth.json"
    );
}
