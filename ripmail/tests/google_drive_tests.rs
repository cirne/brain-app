//! Google Drive source helpers (no live API).

use std::collections::HashMap;
use std::path::Path;

use ripmail::config::{
    FileSourceConfigJson, MailboxImapAuthKind, ResolvedGoogleDrive, ResolvedMailbox, SourceKind,
};
use ripmail::sources::run_google_drive_sync;
use ripmail::{content_fingerprint, drive_cache_rel_path};
use rusqlite::Connection;

#[test]
fn google_drive_sync_errors_when_file_source_roots_empty() {
    let mut conn = Connection::open_in_memory().unwrap();
    let mb = ResolvedMailbox {
        id: "gd".into(),
        kind: SourceKind::GoogleDrive,
        email: "u@gmail.com".into(),
        imap_host: String::new(),
        imap_port: 993,
        imap_user: String::new(),
        imap_aliases: vec![],
        imap_password: String::new(),
        imap_auth: MailboxImapAuthKind::GoogleOAuth,
        include_in_default: true,
        maildir_path: std::path::PathBuf::from("/tmp/m"),
        apple_mail_root: None,
        file_source: Some(FileSourceConfigJson::default()),
        calendar: None,
        google_drive: Some(ResolvedGoogleDrive {
            email: "u@gmail.com".into(),
            token_mailbox_id: "mb".into(),
            include_shared_with_me: false,
        }),
    };
    let home = Path::new("/tmp");
    let env: HashMap<String, String> = HashMap::new();
    let r = run_google_drive_sync(&mut conn, &mb, home, &env, &env, false);
    assert!(r.is_err());
    let msg = r.unwrap_err().to_string();
    assert!(
        msg.contains("add at least one folder"),
        "unexpected error: {}",
        msg
    );
}

#[test]
fn google_drive_source_kind_serde_roundtrip() {
    let k = SourceKind::GoogleDrive;
    let j = serde_json::to_string(&k).unwrap();
    assert_eq!(j, "\"googleDrive\"");
    let back: SourceKind = serde_json::from_str(&j).unwrap();
    assert_eq!(back, SourceKind::GoogleDrive);
}

#[test]
fn drive_cache_rel_path_is_stable() {
    assert_eq!(drive_cache_rel_path("fileId123"), "cache/fileId123.md");
}

#[test]
fn content_fingerprint_uses_md5_when_present() {
    assert_eq!(content_fingerprint(Some("ab12"), b"any"), "md5:ab12");
}

#[test]
fn content_fingerprint_sha256_when_no_md5() {
    let fp = content_fingerprint(None, b"hello");
    assert!(fp.starts_with("sha256:"));
    assert_eq!(fp.len(), "sha256:".len() + 64);
}
