//! `ripmail setup` upserts mailboxes without wiping existing entries.

use std::fs;

use ripmail::{
    update_mailbox_identity, update_mailbox_management, upsert_mailbox_setup, IdentityPatch,
};
use tempfile::tempdir;

#[test]
fn second_setup_adds_mailbox_without_removing_first() {
    let dir = tempdir().unwrap();
    let home = dir.path();
    upsert_mailbox_setup(
        home,
        "alice@test.com",
        "secret1",
        None,
        None,
        None,
        None,
        Some("1y"),
        None,
    )
    .unwrap();
    upsert_mailbox_setup(
        home,
        "bob@test.com",
        "secret2",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let raw = fs::read_to_string(home.join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let arr = v["sources"].as_array().expect("sources array");
    assert_eq!(arr.len(), 2);
    assert!(arr.iter().any(|m| m["email"] == "alice@test.com"));
    assert!(arr.iter().any(|m| m["email"] == "bob@test.com"));
    assert!(home.join("alice_test_com").join(".env").exists());
    assert!(home.join("bob_test_com").join(".env").exists());
}

#[test]
fn setup_with_explicit_id_updates_same_entry() {
    let dir = tempdir().unwrap();
    let home = dir.path();
    upsert_mailbox_setup(
        home,
        "first@corp.com",
        "pw",
        None,
        Some("work"),
        Some("imap.corp.com"),
        Some(993),
        Some("1y"),
        None,
    )
    .unwrap();
    upsert_mailbox_setup(
        home,
        "updated@corp.com",
        "pw2",
        None,
        Some("work"),
        Some("imap.corp.com"),
        Some(993),
        None,
        None,
    )
    .unwrap();
    let raw = fs::read_to_string(home.join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let arr = v["sources"].as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], "work");
    assert_eq!(arr[0]["email"], "updated@corp.com");
}

#[test]
fn update_mailbox_management_writes_enabled_true() {
    let dir = tempdir().unwrap();
    let home = dir.path();
    // Seed a minimal config so read_config_json has something to preserve.
    upsert_mailbox_setup(
        home,
        "user@test.com",
        "pw",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    update_mailbox_management(home, true).unwrap();

    let raw = fs::read_to_string(home.join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["mailboxManagement"]["enabled"], true);
    // allow is absent (None serializes to null / missing key)
    assert!(v["mailboxManagement"]["allow"].is_null());
    // Other keys are preserved
    assert!(v["sources"].as_array().is_some());
}

#[test]
fn update_mailbox_management_writes_enabled_false() {
    let dir = tempdir().unwrap();
    let home = dir.path();
    upsert_mailbox_setup(
        home,
        "user@test.com",
        "pw",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    update_mailbox_management(home, false).unwrap();

    let raw = fs::read_to_string(home.join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["mailboxManagement"]["enabled"], false);
}

#[test]
fn update_mailbox_management_preserves_existing_config() {
    let dir = tempdir().unwrap();
    let home = dir.path();
    upsert_mailbox_setup(
        home,
        "alice@test.com",
        "secret",
        None,
        None,
        None,
        None,
        Some("6m"),
        None,
    )
    .unwrap();

    update_mailbox_management(home, true).unwrap();

    let raw = fs::read_to_string(home.join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    // mailboxManagement was written
    assert_eq!(v["mailboxManagement"]["enabled"], true);
    // Mailboxes array was not disturbed
    let arr = v["sources"].as_array().expect("sources array");
    assert!(arr.iter().any(|m| m["email"] == "alice@test.com"));
    // Sync block preserved
    assert!(v["sync"]["defaultSince"].is_string());
}

#[test]
fn upsert_preserves_identity_unless_patch_supplied() {
    let dir = tempdir().unwrap();
    let home = dir.path();
    upsert_mailbox_setup(
        home,
        "user@test.com",
        "pw",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let patch = IdentityPatch {
        preferred_name: Some("Jane".into()),
        ..Default::default()
    };
    update_mailbox_identity(home, "user_test_com", &patch).unwrap();
    upsert_mailbox_setup(
        home,
        "user@test.com",
        "pw2",
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let raw = fs::read_to_string(home.join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["sources"][0]["identity"]["preferredName"], "Jane");
}

#[test]
fn update_mailbox_management_preserves_allow_list() {
    let dir = tempdir().unwrap();
    let home = dir.path();
    fs::write(
        home.join("config.json"),
        r#"{"mailboxManagement":{"enabled":false,"allow":["archive"]}}"#,
    )
    .unwrap();

    ripmail::update_mailbox_management(home, true).unwrap();
    let raw = fs::read_to_string(home.join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(v["mailboxManagement"]["enabled"], true);
    assert_eq!(
        v["mailboxManagement"]["allow"],
        serde_json::json!(["archive"])
    );
}
