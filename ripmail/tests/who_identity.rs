//! Integration tests: `who`, address normalize, nicknames, infer-name, signature parse, phonetic/fuzzy match.

use std::collections::HashSet;
use std::process::Command;

use ripmail::{
    infer_name_from_address, is_noreply, name_matches_phonetically, normalize_address, open_memory,
    parse_signature_block, persist_message, who, MailboxEntry, ParsedMessage, WhoOptions,
};

const MAILBOX: &str = "[Gmail]/All Mail";

fn insert(
    conn: &rusqlite::Connection,
    mid: &str,
    from: &str,
    from_name: Option<&str>,
    to: &str,
    uid: i64,
) {
    let mut p = ParsedMessage {
        message_id: mid.into(),
        from_address: from.into(),
        from_name: from_name.map(String::from),
        to_addresses: serde_json::from_str(to).unwrap_or_default(),
        cc_addresses: vec![],
        to_recipients: vec![],
        cc_recipients: vec![],
        subject: "s".into(),
        date: "2025-01-01T12:00:00Z".into(),
        body_text: "b".into(),
        body_html: None,
        attachments: vec![],
        category: None,
        ..Default::default()
    };
    persist_message(conn, &mut p, MAILBOX, "", uid, "[]", "x.eml").unwrap();
}

#[test]
fn who_top_contacts_sorted() {
    let conn = open_memory().unwrap();
    for i in 0..5 {
        insert(
            &conn,
            &format!("a{i}@t"),
            "alice@corp.com",
            Some("Alice"),
            "[]",
            i,
        );
    }
    insert(&conn, "b@t", "bob@corp.com", Some("Bob"), "[]", 10);
    let r = who(
        &conn,
        &WhoOptions {
            query: String::new(),
            limit: 10,
            include_noreply: false,
            mailbox_ids: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!r.people.is_empty());
    assert_eq!(r.people[0].primary_address, "alice@corp.com");
}

#[test]
fn who_query_phonetic_match() {
    let conn = open_memory().unwrap();
    insert(
        &conn,
        "j1@t",
        "john.doe@example.com",
        Some("John Doe"),
        "[]",
        1,
    );
    let r = who(
        &conn,
        &WhoOptions {
            query: "Jon".into(),
            limit: 10,
            include_noreply: false,
            mailbox_ids: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(r.people.len(), 1);
    assert!(r.people[0].primary_address.contains("john.doe"));
}

#[test]
fn who_query_fuzzy_match() {
    let conn = open_memory().unwrap();
    insert(
        &conn,
        "j2@t",
        "jane@example.com",
        Some("John Smith"),
        "[]",
        1,
    );
    let r = who(
        &conn,
        &WhoOptions {
            query: "Johm".into(),
            limit: 10,
            include_noreply: false,
            mailbox_ids: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(r.people.len(), 1);
}

#[test]
fn who_uses_to_recipient_display_name() {
    let conn = open_memory().unwrap();
    let mut p = ParsedMessage {
        message_id: "m-to@test".into(),
        from_address: "me@me.com".into(),
        from_name: None,
        to_addresses: vec!["dwilcox@greenlonghorninc.com".into()],
        cc_addresses: vec![],
        to_recipients: vec![MailboxEntry {
            name: Some("Don Wilcox".into()),
            address: "dwilcox@greenlonghorninc.com".into(),
        }],
        cc_recipients: vec![],
        subject: "s".into(),
        date: "2025-01-01T12:00:00Z".into(),
        body_text: "b".into(),
        body_html: None,
        attachments: vec![],
        category: None,
        ..Default::default()
    };
    persist_message(&conn, &mut p, MAILBOX, "", 1, "[]", "x.eml").unwrap();
    let opts = WhoOptions {
        query: "dwilcox@greenlonghorninc.com".into(),
        limit: 10,
        include_noreply: false,
        mailbox_ids: None,
        ..Default::default()
    };
    let r = who(&conn, &opts).unwrap();
    assert_eq!(r.people.len(), 1);
    assert_eq!(r.people[0].display_name.as_deref(), Some("Don Wilcox"));
    assert!(r.people[0].person_id.starts_with('p'));
    assert!(!r.people[0].person_id.is_empty());
}

#[test]
fn who_gmail_normalize_merges_duplicate_forms() {
    let conn = open_memory().unwrap();
    insert(
        &conn,
        "m1@t",
        "d.wilcox@gmail.com",
        Some("Dee Wilcox"),
        "[]",
        1,
    );
    insert(
        &conn,
        "m2@t",
        "dwilcox@gmail.com",
        Some("Dee Wilcox"),
        "[]",
        2,
    );
    let r = who(
        &conn,
        &WhoOptions {
            query: "dwilcox@gmail.com".into(),
            limit: 10,
            include_noreply: false,
            mailbox_ids: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(r.people.len(), 1);
    assert_eq!(r.people[0].primary_address, "d.wilcox@gmail.com");
}

#[test]
fn who_json_deterministic_across_calls() {
    let conn = open_memory().unwrap();
    insert(&conn, "a@t", "z@z.com", Some("Zed"), "[]", 1);
    let opts = WhoOptions {
        query: String::new(),
        limit: 5,
        include_noreply: false,
        mailbox_ids: None,
        ..Default::default()
    };
    let a = serde_json::to_string(&who(&conn, &opts).unwrap()).unwrap();
    let b = serde_json::to_string(&who(&conn, &opts).unwrap()).unwrap();
    assert_eq!(a, b);
}

#[test]
fn who_suggested_display_name_from_infer_when_no_header_name() {
    let conn = open_memory().unwrap();
    insert(&conn, "inf@t", "alanfinley@example.com", None, "[]", 1);
    let r = who(
        &conn,
        &WhoOptions {
            query: "alanfinley@example.com".into(),
            limit: 5,
            include_noreply: false,
            mailbox_ids: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(r.people.len(), 1);
    assert!(r.people[0].display_name.is_none());
    assert_eq!(
        r.people[0].suggested_display_name.as_deref(),
        Some("Alan Finley")
    );
}

#[test]
fn who_owner_centric_counts_sent_when_from_matches_alias() {
    let conn = open_memory().unwrap();
    let mut p = ParsedMessage {
        message_id: "owner-sent-alias@test".into(),
        from_address: "b@alias.com".into(),
        from_name: None,
        to_addresses: vec!["peer@example.com".into()],
        cc_addresses: vec![],
        to_recipients: vec![MailboxEntry {
            name: None,
            address: "peer@example.com".into(),
        }],
        cc_recipients: vec![],
        subject: "s".into(),
        date: "2025-01-02T12:00:00Z".into(),
        body_text: "b".into(),
        body_html: None,
        attachments: vec![],
        category: None,
        ..Default::default()
    };
    persist_message(&conn, &mut p, MAILBOX, "", 1, "[]", "x.eml").unwrap();

    let mut omit = HashSet::new();
    omit.insert(normalize_address("a@primary.com"));
    omit.insert(normalize_address("b@alias.com"));

    let r = who(
        &conn,
        &WhoOptions {
            query: String::new(),
            limit: 10,
            include_noreply: false,
            mailbox_ids: None,
            owner_identities: Some(vec!["a@primary.com".into(), "b@alias.com".into()]),
            omit_identity_norms: omit,
        },
    )
    .unwrap();
    let peer = r
        .people
        .iter()
        .find(|x| x.primary_address == "peer@example.com")
        .expect("peer row");
    assert_eq!(peer.sent_count, 1);
    assert_eq!(peer.received_count, 0);
}

#[test]
fn who_unknown_address_returns_empty_people() {
    let conn = open_memory().unwrap();
    insert(&conn, "k@t", "known@example.com", Some("K"), "[]", 1);
    let r = who(
        &conn,
        &WhoOptions {
            query: "nobody-here@example.com".into(),
            limit: 10,
            include_noreply: false,
            mailbox_ids: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(r.people.is_empty());
}

#[test]
fn noreply_detection() {
    assert!(is_noreply("noreply@company.com"));
    assert!(is_noreply("no-reply@x.org"));
    assert!(!is_noreply("alice@human.com"));
}

#[test]
fn email_normalize_lowercases_domain() {
    assert_eq!(
        normalize_address("Lewis.Cirne+tag@gmail.com"),
        "lewiscirne@gmail.com"
    );
}

#[test]
fn nickname_alias_lookup() {
    assert_eq!(ripmail::canonical_first_name("Bob"), "robert");
}

#[test]
fn signature_phone_extraction() {
    let sig = "John Doe\n(512) 555-1234";
    let ex = parse_signature_block(sig, "john@example.com");
    assert!(ex.phone.is_some());
    let p = ex.phone.unwrap();
    assert!(p.contains("512") && p.contains("555") && p.contains("1234"));
}

#[test]
fn infer_name_from_local_part() {
    assert_eq!(
        infer_name_from_address("lewis.cirne@alum.dartmouth.org").as_deref(),
        Some("Lewis Cirne")
    );
    assert_eq!(
        infer_name_from_address("katelyn_cirne@icloud.com").as_deref(),
        Some("Katelyn Cirne")
    );
    assert_eq!(
        infer_name_from_address("lewisCirne@example.com").as_deref(),
        Some("Lewis Cirne")
    );
    assert_eq!(
        infer_name_from_address("alanfinley@example.com").as_deref(),
        Some("Alan Finley")
    );
    assert_eq!(
        infer_name_from_address("johnsmith@example.com").as_deref(),
        Some("John Smith")
    );
    assert_eq!(
        infer_name_from_address("abrown@somecompany.com").as_deref(),
        Some("A Brown")
    );
    assert_eq!(
        infer_name_from_address("jsmith@example.com").as_deref(),
        Some("J Smith")
    );
    assert!(infer_name_from_address("sjohnson@example.com").is_none());
    assert!(infer_name_from_address("recipient@example.com").is_none());
    assert!(infer_name_from_address("fredbrown@example.com").is_none());
    assert!(infer_name_from_address("ab@example.com").is_none());
}

#[test]
fn phonetic_jon_john() {
    assert!(name_matches_phonetically("john", "jon"));
}

#[test]
fn who_exits_zero() {
    let dir = tempfile::tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let st = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["who", "--limit", "3"])
        .status()
        .unwrap();
    assert!(st.success());
}
