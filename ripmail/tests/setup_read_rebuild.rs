//! Integration tests: `setup` writes, env fallbacks, read/thread CLI, rebuild-index from maildir.

use std::collections::HashSet;
use std::fs;
use std::process::Command;

use ripmail::{
    db, open_memory, persist_message, rebuild_from_maildir, rebuild_from_maildir_sequential,
    resolve_setup_email, search_with_meta, write_ripmail_config_and_env, write_setup,
    ParsedMessage, SearchOptions, SetupArgs, WriteZmailParams,
};
use tempfile::tempdir;

const MAILBOX: &str = "[Gmail]/All Mail";

#[test]
fn setup_writes_config_json() {
    let dir = tempdir().unwrap();
    write_setup(
        dir.path(),
        "alice@test.com",
        "secret",
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mb = &v["sources"][0];
    assert_eq!(mb["kind"], "imap");
    assert_eq!(mb["email"], "alice@test.com");
    assert_eq!(mb["imap"]["host"], "imap.gmail.com");
    assert_eq!(mb["imap"]["port"], 993);
    assert_eq!(v["sync"]["defaultSince"], "1y");
    assert_eq!(v["sync"]["mailbox"], "");
    assert_eq!(
        v["sync"]["excludeLabels"],
        serde_json::json!(["Trash", "Spam"])
    );
    let mb_dotenv = fs::read_to_string(dir.path().join("alice_test_com").join(".env")).unwrap();
    assert!(mb_dotenv.contains("RIPMAIL_IMAP_PASSWORD=secret"));
}

#[test]
fn write_ripmail_wizard_shape_matches_node() {
    let dir = tempdir().unwrap();
    write_ripmail_config_and_env(&WriteZmailParams {
        home: dir.path(),
        email: "bob@corp.example",
        password: "pw",
        openai_key: Some("sk-test"),
        imap_host: "imap.corp.example",
        imap_port: 993,
        default_since: "7d",
    })
    .unwrap();
    let raw = fs::read_to_string(dir.path().join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mb = &v["sources"][0];
    assert_eq!(mb["kind"], "imap");
    assert_eq!(mb["imap"]["host"], "imap.corp.example");
    assert_eq!(mb["imap"]["port"], 993);
    assert_eq!(v["sync"]["defaultSince"], "7d");
    assert_eq!(v["sync"]["mailbox"], "");
    assert_eq!(
        v["sync"]["excludeLabels"],
        serde_json::json!(["Trash", "Spam"])
    );
}

#[test]
fn setup_env_var_fallback() {
    let mut env = std::collections::HashMap::new();
    env.insert("RIPMAIL_EMAIL".into(), "env@user.com".into());
    let args = SetupArgs {
        email: None,
        password: Some("p".into()),
        openai_key: None,
        mailbox_id: None,
        imap_host: None,
        imap_port: None,
        no_validate: true,
        identity_patch: None,
    };
    assert_eq!(
        resolve_setup_email(&args, &env).as_deref(),
        Some("env@user.com")
    );
}

#[test]
fn status_json_output() {
    let dir = tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["status", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(v.get("sync").is_some());
    assert!(v["sync"].get("totalMessages").is_some());
    assert_eq!(
        v["search"]["indexedMessages"], v["search"]["ftsReady"],
        "indexedMessages must match ftsReady (local messages row count)"
    );
    assert!(v.get("mailboxes").is_some());
}

#[test]
fn read_message_text_output() {
    let dir = tempdir().unwrap();
    fs::create_dir_all(dir.path().join("data/cur")).unwrap();
    let eml_path = dir.path().join("data/cur/msg1.eml");
    let raw = b"From: a@b.com\r\nSubject: Hi\r\nMessage-ID: <mid-read@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nBody line one.";
    fs::write(&eml_path, raw).unwrap();

    let db_path = dir.path().join("data/ripmail.db");
    let conn = db::open_file(&db_path).unwrap();
    let p = ParsedMessage {
        message_id: "<mid-read@test>".into(),
        from_address: "a@b.com".into(),
        from_name: None,
        to_addresses: vec![],
        cc_addresses: vec![],
        to_recipients: vec![],
        cc_recipients: vec![],
        subject: "Hi".into(),
        date: "2024-01-01T12:00:00Z".into(),
        body_text: "ignored".into(),
        body_html: None,
        attachments: vec![],
        category: None,
        ..Default::default()
    };
    let rel = "cur/msg1.eml";
    persist_message(&conn, &p, MAILBOX, "", 1, "[]", rel).unwrap();
    drop(conn);

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["read", "<mid-read@test>"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("Body line one"));
    assert!(s.contains("From: a@b.com"));
    assert!(s.contains("Subject: Hi"));
}

#[test]
fn read_message_json_includes_recipients_and_threading() {
    let dir = tempdir().unwrap();
    fs::create_dir_all(dir.path().join("data/cur")).unwrap();
    let eml_path = dir.path().join("data/cur/msg2.eml");
    let raw = b"From: Alice <alice@a.com>\r\n\
To: Bob <bob@b.com>\r\n\
Cc: Carol <carol@c.com>\r\n\
Bcc: Dave <dave@d.com>\r\n\
Reply-To: replies@a.com\r\n\
Subject: Meet\r\n\
Message-ID: <mid-json@test>\r\n\
In-Reply-To: <parent@x.com>\r\n\
References: <a@b> <c@d>\r\n\
Date: Mon, 1 Jan 2024 12:00:00 +0000\r\n\
MIME-Version: 1.0\r\n\
Content-Type: text/plain\r\n\
\r\n\
Hello.";
    fs::write(&eml_path, raw).unwrap();

    let db_path = dir.path().join("data/ripmail.db");
    let conn = db::open_file(&db_path).unwrap();
    let p = ParsedMessage {
        message_id: "<mid-json@test>".into(),
        from_address: "alice@a.com".into(),
        from_name: Some("Alice".into()),
        to_addresses: vec!["bob@b.com".into()],
        cc_addresses: vec!["carol@c.com".into()],
        to_recipients: vec![],
        cc_recipients: vec![],
        subject: "Meet".into(),
        date: "2024-01-01T12:00:00Z".into(),
        body_text: "ignored".into(),
        body_html: None,
        attachments: vec![],
        category: None,
        ..Default::default()
    };
    let rel = "cur/msg2.eml";
    persist_message(&conn, &p, MAILBOX, "", 1, "[]", rel).unwrap();
    drop(conn);

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["read", "<mid-json@test>", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["messageId"], "mid-json@test");
    assert_eq!(v["threadId"], "mid-json@test");
    assert_eq!(v["bcc"].as_array().unwrap().len(), 1);
    assert_eq!(v["bcc"][0]["address"], "dave@d.com");
    assert_eq!(v["inReplyTo"], "parent@x.com");
    let refs = v["references"].as_array().unwrap();
    assert!(refs.iter().any(|x| x == "a@b"));
    assert_eq!(v["recipientsDisclosed"], true);
    assert_eq!(v["body"], "Hello.");
}

#[test]
fn read_multiple_messages_json_is_array_in_cli_order() {
    let dir = tempdir().unwrap();
    fs::create_dir_all(dir.path().join("data/cur")).unwrap();

    let cases: Vec<(&str, &str, &[u8])> = vec![
        (
            "msg-a.eml",
            "<mid-a@test>",
            b"From: a@b.com\r\nSubject: A\r\nMessage-ID: <mid-a@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nAlpha."
                .as_slice(),
        ),
        (
            "msg-b.eml",
            "<mid-b@test>",
            b"From: c@d.com\r\nSubject: B\r\nMessage-ID: <mid-b@test>\r\nDate: Mon, 1 Jan 2024 13:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nBeta."
                .as_slice(),
        ),
    ];

    let db_path = dir.path().join("data/ripmail.db");
    let conn = db::open_file(&db_path).unwrap();
    for (filename, mid, raw) in cases {
        fs::write(dir.path().join("data/cur").join(filename), raw).unwrap();
        let p = ParsedMessage {
            message_id: mid.to_string(),
            from_address: "x@y.com".into(),
            from_name: None,
            to_addresses: vec![],
            cc_addresses: vec![],
            to_recipients: vec![],
            cc_recipients: vec![],
            subject: "s".into(),
            date: "2024-01-01T12:00:00Z".into(),
            body_text: "ignored".into(),
            body_html: None,
            attachments: vec![],
            category: None,
            ..Default::default()
        };
        let rel = format!("cur/{filename}");
        persist_message(&conn, &p, MAILBOX, "", 1, "[]", &rel).unwrap();
    }
    drop(conn);

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["read", "<mid-b@test>", "<mid-a@test>", "--json"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let arr: Vec<serde_json::Value> = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["messageId"], "mid-b@test");
    assert_eq!(arr[0]["body"], "Beta.");
    assert_eq!(arr[1]["messageId"], "mid-a@test");
    assert_eq!(arr[1]["body"], "Alpha.");
}

#[test]
fn read_multiple_messages_text_has_batch_separator() {
    let dir = tempdir().unwrap();
    fs::create_dir_all(dir.path().join("data/cur")).unwrap();

    let db_path = dir.path().join("data/ripmail.db");
    for (filename, mid, raw) in [
        (
            "m1.eml",
            "<mid-m1@test>",
            b"From: u@t.com\r\nSubject: One\r\nMessage-ID: <mid-m1@test>\r\nDate: Mon, 1 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nFirst body."
                .as_slice(),
        ),
        (
            "m2.eml",
            "<mid-m2@test>",
            b"From: u@t.com\r\nSubject: Two\r\nMessage-ID: <mid-m2@test>\r\nDate: Mon, 1 Jan 2024 13:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nSecond body."
                .as_slice(),
        ),
    ] {
        fs::write(dir.path().join("data/cur").join(filename), raw).unwrap();
        let conn = db::open_file(&db_path).unwrap();
        let p = ParsedMessage {
            message_id: mid.to_string(),
            from_address: "u@t.com".into(),
            from_name: None,
            to_addresses: vec![],
            cc_addresses: vec![],
            to_recipients: vec![],
            cc_recipients: vec![],
            subject: "s".into(),
            date: "2024-01-01T12:00:00Z".into(),
            body_text: "ignored".into(),
            body_html: None,
            attachments: vec![],
            category: None,
            ..Default::default()
        };
        let rel = format!("cur/{filename}");
        persist_message(&conn, &p, MAILBOX, "", 1, "[]", &rel).unwrap();
        drop(conn);
    }

    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["read", "<mid-m1@test>", "<mid-m2@test>"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("First body."));
    assert!(s.contains("Second body."));
    assert!(s.contains("--- ripmail ---"));
}

#[test]
fn rebuild_index_from_maildir() {
    let dir = tempdir().unwrap();
    let maildir = dir.path().join("maildir/cur");
    fs::create_dir_all(&maildir).unwrap();
    let eml = b"From: inv@x.com\r\nSubject: inv\r\nMessage-ID: <inv1@test>\r\nDate: Tue, 2 Jan 2024 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\ninvoice total 99";
    fs::write(maildir.join("a.eml"), eml).unwrap();

    let db_path = dir.path().join("ripmail.db");
    let mut conn = db::open_file(&db_path).unwrap();
    let n = rebuild_from_maildir(&mut conn, &dir.path().join("maildir")).unwrap();
    assert!(n >= 1);
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("invoice".into()),
            limit: Some(10),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!set.results.is_empty());
}

#[test]
fn parallel_rebuild_correct() {
    let dir = tempdir().unwrap();
    let maildir = dir.path().join("m/cur");
    fs::create_dir_all(&maildir).unwrap();
    for i in 0..50 {
        let eml = format!(
            "From: u{i}@t.com\r\n\
Subject: parallel subject {i}\r\n\
Message-ID: <m{i}@test>\r\n\
Date: Mon, 1 Jan 2024 12:00:00 +0000\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"b{i}\"\r\n\
\r\n\
--b{i}\r\n\
Content-Type: text/plain\r\n\
\r\n\
invoice body {i}\r\n\
--b{i}\r\n\
Content-Type: application/octet-stream; name=\"f{i}.txt\"\r\n\
Content-Disposition: attachment; filename=\"f{i}.txt\"\r\n\
\r\n\
payload-{i}\r\n\
--b{i}--\r\n"
        );
        fs::write(maildir.join(format!("{i}.eml")), eml.as_bytes()).unwrap();
    }

    let mut c1 = open_memory().unwrap();
    rebuild_from_maildir(&mut c1, &dir.path().join("m")).unwrap();
    let mut c2 = open_memory().unwrap();
    rebuild_from_maildir_sequential(&mut c2, &dir.path().join("m")).unwrap();

    fn ids(conn: &rusqlite::Connection) -> HashSet<String> {
        let mut stmt = conn.prepare("SELECT message_id FROM messages").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect()
    }
    let a = ids(&c1);
    let b = ids(&c2);
    assert_eq!(a, b);
    assert_eq!(a.len(), 50);

    fn subjects(conn: &rusqlite::Connection) -> HashSet<String> {
        let mut stmt = conn.prepare("SELECT subject FROM messages").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect()
    }
    assert_eq!(subjects(&c1), subjects(&c2));

    let count1: i64 = c1
        .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
        .unwrap();
    let count2: i64 = c2
        .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count1, 50);
    assert_eq!(count2, 50);

    let fts1 = search_with_meta(
        &c1,
        &SearchOptions {
            query: Some("invoice".into()),
            limit: Some(100),
            ..Default::default()
        },
    )
    .unwrap();
    let fts2 = search_with_meta(
        &c2,
        &SearchOptions {
            query: Some("invoice".into()),
            limit: Some(100),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(fts1.results.len(), 50);
    assert_eq!(fts2.results.len(), 50);
}
