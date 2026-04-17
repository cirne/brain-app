//! Integration tests: FTS keyword search, inline query operators, filter-only queries, result JSON shape.

use std::process::Command;

use ripmail::{
    escape_fts5_query, open_memory, parse_search_query, persist_message,
    resolve_search_json_format, search_result_to_slim_json_row, search_with_meta, ParsedMessage,
    SearchOptions, SearchResultFormatPreference, SEARCH_AUTO_SLIM_THRESHOLD,
};

const MAILBOX: &str = "[Gmail]/All Mail";

#[allow(clippy::too_many_arguments)]
fn insert_msg(
    conn: &rusqlite::Connection,
    mid: &str,
    from: &str,
    subject: &str,
    body: &str,
    date: &str,
    uid: i64,
    category: Option<&str>,
    to_json: &str,
) {
    let p = ParsedMessage {
        message_id: mid.into(),
        from_address: from.into(),
        from_name: None,
        to_addresses: serde_json::from_str(to_json).unwrap_or_default(),
        cc_addresses: vec![],
        to_recipients: vec![],
        cc_recipients: vec![],
        subject: subject.into(),
        date: date.into(),
        body_text: body.into(),
        body_html: None,
        attachments: vec![],
        category: category.map(str::to_string),
        ..Default::default()
    };
    persist_message(conn, &p, MAILBOX, "", uid, "[]", "x.eml").unwrap();
}

#[test]
fn fts_basic_keyword() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "m1@test",
        "a@b.com",
        "Re: invoice",
        "please pay this invoice",
        "2025-01-10T12:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "m2@test",
        "c@d.com",
        "hello",
        "no keywords",
        "2025-01-11T12:00:00Z",
        2,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "m3@test",
        "e@f.com",
        "other",
        "invoice number 9",
        "2025-01-12T12:00:00Z",
        3,
        None,
        "[]",
    );
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("invoice".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    let ids: Vec<_> = set.results.iter().map(|r| r.message_id.as_str()).collect();
    assert!(ids.contains(&"m1@test"), "m1: {:?}", ids);
    assert!(ids.contains(&"m3@test"), "m3: {:?}", ids);
    assert!(!ids.contains(&"m2@test"));
}

#[test]
fn fts_or_query() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "a1@test",
        "x@y.com",
        "s",
        "foo only",
        "2025-02-01T12:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "a2@test",
        "x@y.com",
        "s",
        "bar only",
        "2025-02-02T12:00:00Z",
        2,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "a3@test",
        "x@y.com",
        "s",
        "neither",
        "2025-02-03T12:00:00Z",
        3,
        None,
        "[]",
    );
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("foo bar".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    let ids: Vec<_> = set.results.iter().map(|r| r.message_id.as_str()).collect();
    assert!(ids.contains(&"a1@test"));
    assert!(ids.contains(&"a2@test"));
    assert!(!ids.contains(&"a3@test"));
}

#[test]
fn fts_from_filter() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "b1@test",
        "alice@x.com",
        "sub",
        "secret word",
        "2025-03-01T12:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "b2@test",
        "bob@x.com",
        "sub",
        "secret word",
        "2025-03-02T12:00:00Z",
        2,
        None,
        "[]",
    );
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("from:alice secret".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(set.results.len(), 1);
    assert_eq!(set.results[0].message_id, "b1@test");
}

/// BUG-037: `(from:x OR to:x) keyword` must AND FTS with (from OR to), not require both addresses.
#[test]
fn fts_from_or_to_union_parenthesized_with_keyword() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "bug37-from@test",
        "dad@example.com",
        "s",
        "weekend golf plans",
        "2025-03-01T12:00:00Z",
        1,
        None,
        r#"["other@example.com"]"#,
    );
    insert_msg(
        &conn,
        "bug37-to@test",
        "other@example.com",
        "s",
        "please confirm tee time",
        "2025-03-02T12:00:00Z",
        2,
        None,
        r#"["dad@example.com"]"#,
    );
    insert_msg(
        &conn,
        "bug37-neither@test",
        "stranger@example.com",
        "s",
        "golf and tee time",
        "2025-03-03T12:00:00Z",
        3,
        None,
        "[]",
    );
    let q = r#"(from:dad@example.com OR to:dad@example.com) (golf OR "tee time")"#;
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some(q.into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    let ids: Vec<_> = set.results.iter().map(|r| r.message_id.as_str()).collect();
    assert!(ids.contains(&"bug37-from@test"), "from dad: {:?}", ids);
    assert!(ids.contains(&"bug37-to@test"), "to dad: {:?}", ids);
    assert!(
        !ids.contains(&"bug37-neither@test"),
        "stranger should not match: {:?}",
        ids
    );
}

#[test]
fn fts_date_filter_after_before() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "d1@test",
        "a@b.com",
        "s",
        "meet",
        "2025-04-01T12:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "d2@test",
        "a@b.com",
        "s",
        "meet",
        "2025-06-15T12:00:00Z",
        2,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "d3@test",
        "a@b.com",
        "s",
        "meet",
        "2025-08-01T12:00:00Z",
        3,
        None,
        "[]",
    );
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("after:2025-05-01 before:2025-07-01 meet".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(set.results.len(), 1);
    assert_eq!(set.results[0].message_id, "d2@test");
}

#[test]
fn fts_empty_query_filter_only() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "f1@test",
        "vip@corp.com",
        "x",
        "body",
        "2025-05-10T12:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "f2@test",
        "other@corp.com",
        "x",
        "body",
        "2025-05-11T12:00:00Z",
        2,
        None,
        "[]",
    );
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("".into()),
            from_address: Some("vip".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(set.results.len(), 1);
    assert_eq!(set.results[0].from_address, "vip@corp.com");
}

#[test]
fn fts_contact_rank_rerank() {
    let conn = open_memory().unwrap();
    let owner = "me@example.com";
    let vip = "vip@example.com";
    let low = "low@example.com";
    // Build owner → vip history (same thread boosts sent_count for vip).
    for i in 0..6 {
        insert_msg(
            &conn,
            &format!("hist{i}@test"),
            owner,
            "ping",
            "x",
            "2024-01-01T12:00:00Z",
            100 + i,
            None,
            &format!("[\"{vip}\"]"),
        );
    }
    // Two FTS matches with tied-ish content/date.
    insert_msg(
        &conn,
        "match-low@test",
        low,
        "s",
        "budget review",
        "2025-06-01T12:00:00Z",
        200,
        None,
        &format!("[\"{owner}\"]"),
    );
    insert_msg(
        &conn,
        "match-vip@test",
        vip,
        "s",
        "budget review",
        "2025-06-01T12:00:00Z",
        201,
        None,
        &format!("[\"{owner}\"]"),
    );
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("budget".into()),
            limit: Some(10),
            owner_address: Some(owner.into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        set.results.len() >= 2,
        "expected 2 results, got {}",
        set.results.len()
    );
    assert_eq!(
        set.results[0].message_id, "match-vip@test",
        "higher-contact peer should rank first: {:?}",
        set.results
    );
}

#[test]
fn fts_include_all_flag() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "n1@test",
        "a@b.com",
        "promo",
        "sale discount",
        "2025-01-01T12:00:00Z",
        1,
        Some("promotional"),
        "[]",
    );
    insert_msg(
        &conn,
        "n2@test",
        "a@b.com",
        "real",
        "sale discount",
        "2025-01-02T12:00:00Z",
        2,
        None,
        "[]",
    );
    let default_search = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("sale".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(default_search.results.len(), 1);
    assert_eq!(default_search.results[0].message_id, "n2@test");

    let with_all = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("sale".into()),
            limit: Some(20),
            include_all: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(with_all.results.len(), 2);
}

#[test]
fn query_parse_from_inline() {
    let p = parse_search_query("from:alice@x.com budget planning");
    assert_eq!(p.from_address.as_deref(), Some("alice@x.com"));
    assert_eq!(p.query, "budget planning");
}

#[test]
fn query_parse_after_before_inline() {
    let p = parse_search_query("after:2024-01-01 before:2024-12-31 report");
    assert_eq!(p.after_date.as_deref(), Some("2024-01-01"));
    assert!(p.before_date.as_deref().unwrap().starts_with("2024-12-31"));
    assert_eq!(p.query, "report");
}

#[test]
fn query_parse_subject_inline() {
    let p = parse_search_query("subject:Q4 hello");
    assert_eq!(p.subject.as_deref(), Some("Q4"));
    assert_eq!(p.query, "hello");
}

#[test]
fn json_format_slim_vs_full() {
    assert_eq!(
        resolve_search_json_format(
            SEARCH_AUTO_SLIM_THRESHOLD + 1,
            SearchResultFormatPreference::Auto,
            true
        ),
        ripmail::SearchJsonFormat::Slim
    );
    assert_eq!(
        resolve_search_json_format(
            SEARCH_AUTO_SLIM_THRESHOLD,
            SearchResultFormatPreference::Auto,
            true
        ),
        ripmail::SearchJsonFormat::Full
    );
    assert_eq!(
        resolve_search_json_format(999, SearchResultFormatPreference::Full, true),
        ripmail::SearchJsonFormat::Full
    );
    assert_eq!(
        resolve_search_json_format(1, SearchResultFormatPreference::Slim, true),
        ripmail::SearchJsonFormat::Slim
    );
}

#[test]
fn json_slim_row_shape() {
    let r = ripmail::SearchResult {
        message_id: "mid".into(),
        thread_id: "t".into(),
        source_id: String::new(),
        source_kind: String::new(),
        from_address: "a@b.com".into(),
        from_name: Some("Ann".into()),
        subject: "Hi".into(),
        date: "2025-01-01T00:00:00Z".into(),
        snippet: "".into(),
        body_preview: "".into(),
        rank: 0.0,
    };
    let v = search_result_to_slim_json_row(&r);
    assert_eq!(v["messageId"], "mid");
    assert_eq!(v["subject"], "Hi");
    assert_eq!(v["fromName"], "Ann");
}

#[test]
fn search_result_total_matched() {
    let conn = open_memory().unwrap();
    for i in 0..15 {
        insert_msg(
            &conn,
            &format!("tm{i}@test"),
            "a@b.com",
            "s",
            "keywordalpha",
            "2025-01-01T12:00:00Z",
            i,
            None,
            "[]",
        );
    }
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("keywordalpha".into()),
            limit: Some(5),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(set.results.len(), 5);
    assert_eq!(set.total_matched, Some(15));
}

#[test]
fn fts5_special_chars_escaped() {
    let q = "foo[bar]";
    let esc = escape_fts5_query(q);
    assert!(esc.contains('"') || !esc.contains('['), "escaped: {esc}");
}

/// BUG-042: `&`, `+`, etc. must not surface raw FTS5/SQL errors.
#[test]
fn fts_ampersand_plus_query_runs() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "m-amp@test",
        "a@b.com",
        "Q&A",
        "Topic A and Topic B",
        "2025-01-10T12:00:00Z",
        1,
        None,
        "[]",
    );
    search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("Q&A OR C++".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .expect("FTS must accept query with & and + after escaping");
    let plain = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("Topic".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(
        plain.results.iter().any(|r| r.message_id == "m-amp@test"),
        "sanity: message must be indexed"
    );
}

/// BUG-050: unsupported Gmail-style operators fail with a clear error, not SQLite column errors.
#[test]
fn search_rejects_unknown_attachment_operator() {
    let conn = open_memory().unwrap();
    let err = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("attachment:pdf".into()),
            limit: Some(10),
            ..Default::default()
        },
    )
    .expect_err("unknown operator should be rejected before SQL");
    let s = err.to_string();
    assert!(
        s.contains("attachment") || s.contains("Unknown") || s.contains("operator"),
        "{s}"
    );
}

/// BUG-049: `from:` plus keyword remainder must intersect (sender ∩ FTS).
#[test]
fn search_from_operator_plus_keywords_intersects() {
    let conn = open_memory().unwrap();
    insert_msg(
        &conn,
        "m-rudy@test",
        "rudy@example.com",
        "golf",
        "cart tires",
        "2025-02-01T12:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "m-other@test",
        "other@example.com",
        "golf",
        "cart",
        "2025-02-02T12:00:00Z",
        2,
        None,
        "[]",
    );
    let set = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("golf cart from:rudy".into()),
            limit: Some(20),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(set.results.len(), 1, "expected one intersection hit");
    assert_eq!(set.results[0].message_id, "m-rudy@test");
}

#[test]
fn search_exits_zero() {
    let dir = tempfile::tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let st = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["search", "anything", "--limit", "5"])
        .status()
        .unwrap();
    assert!(st.success());
}

/// BUG-034: `--json` is a no-op where JSON is already the default; agents still pass it.
#[test]
fn search_cli_accepts_json_flag() {
    let dir = tempfile::tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let out = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["search", "anything", "--json", "--limit", "3"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("\"results\""), "stdout: {s}");
}

/// BUG-034: `thread` accepts `--text` like other subcommands (default is text).
#[test]
fn thread_cli_accepts_text_flag() {
    let dir = tempfile::tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_ripmail");
    let st = Command::new(bin)
        .env("RIPMAIL_HOME", dir.path())
        .args(["thread", "<no-such-thread>", "--text"])
        .status()
        .unwrap();
    assert!(st.success());
}

/// BUG-020: Domain-based spending queries — demonstrates the discrepancy between correct
/// fromAddress filter and incorrect query-based domain search.
///
/// When asked "summarize my spending on apple.com", the correct approach is to use
/// `fromAddress: "apple.com"` (exhaustive filter). The buggy approach puts the domain
/// in the query parameter, resulting in FTS search that may miss or mismatch results.
///
/// This test inserts transactional emails from multiple vendors and shows the difference
/// in search results between the two approaches.
#[test]
fn bug_020_domain_query_vs_from_filter() {
    let conn = open_memory().unwrap();

    // Insert transactional emails from apple.com (order confirmations, receipts)
    insert_msg(
        &conn,
        "apple-001@test",
        "order-noreply@apple.com",
        "Order Confirmation: MacBook Pro",
        "Thank you for your order. Your MacBook Pro has been confirmed.",
        "2025-03-01T10:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "apple-002@test",
        "receipt@apple.com",
        "Your Receipt for Apple Care",
        "Your purchase of AppleCare+ protection plan is confirmed.",
        "2025-03-05T14:30:00Z",
        2,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "apple-003@test",
        "support@apple.com",
        "Shipping Confirmation",
        "Your order is on its way. Tracking number: APPLE123456",
        "2025-03-10T09:15:00Z",
        3,
        None,
        "[]",
    );

    // Insert emails from other vendors
    insert_msg(
        &conn,
        "amazon-001@test",
        "orders@amazon.com",
        "Order Placed",
        "Your Amazon order has been placed. See your order details for delivery.",
        "2025-03-02T11:00:00Z",
        4,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "google-001@test",
        "noreply@google.com",
        "Google Play Purchase",
        "Receipt for your Google Play Store purchase.",
        "2025-03-04T16:45:00Z",
        5,
        None,
        "[]",
    );

    // Insert a message that mentions "apple" but is NOT from apple.com
    insert_msg(
        &conn,
        "user-msg@test",
        "friend@example.com",
        "Hey, did you get that new Apple watch?",
        "I saw you bought an Apple watch. How do you like it? I'm thinking of getting one too.",
        "2025-03-06T20:00:00Z",
        6,
        None,
        "[]",
    );

    // CORRECT APPROACH: Use fromAddress filter for exhaustive domain search
    let from_filter_search = search_with_meta(
        &conn,
        &SearchOptions {
            from_address: Some("apple.com".into()),
            limit: Some(50),
            ..Default::default()
        },
    )
    .unwrap();

    // BUGGY APPROACH: Put domain in query (FTS search)
    let query_search = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("apple.com".into()),
            limit: Some(50),
            ..Default::default()
        },
    )
    .unwrap();

    // Assert correct behavior: fromAddress filter finds all apple.com senders
    assert_eq!(
        from_filter_search.results.len(),
        3,
        "fromAddress filter should find all 3 apple.com messages"
    );

    let from_ids: Vec<&str> = from_filter_search
        .results
        .iter()
        .map(|r| r.message_id.as_str())
        .collect();
    assert!(
        from_ids.contains(&"apple-001@test"),
        "Should contain order confirmation"
    );
    assert!(
        from_ids.contains(&"apple-002@test"),
        "Should contain receipt"
    );
    assert!(
        from_ids.contains(&"apple-003@test"),
        "Should contain shipping confirmation"
    );

    // Show the bug: FTS query search has different results
    // It will match "apple.com" in the FROM addresses (if they're indexed), but may also
    // match the word "apple" in the body of the friend@example.com email.
    eprintln!(
        "BUG-020 demonstration:\n  fromAddress filter: {} results\n  query search: {} results",
        from_filter_search.results.len(),
        query_search.results.len()
    );

    // The query search may find the friend's message (which contains "Apple" in body/subject)
    // This shows the imprecision of putting a domain in the query instead of using the filter.
    let query_ids: Vec<&str> = query_search
        .results
        .iter()
        .map(|r| r.message_id.as_str())
        .collect();
    eprintln!("Query search results: {:?}", query_ids);

    // Demonstrate the discrepancy
    if query_search.results.len() != from_filter_search.results.len() {
        eprintln!(
            "Result mismatch demonstrates BUG-020: query-based domain search returns {} results vs {} with filter",
            query_search.results.len(),
            from_filter_search.results.len()
        );
    }
}

/// BUG-020 fix: Domain detection in query parsing — basic case.
/// Verify that "apple.com spending" extracts domain correctly and removes it from FTS query.
#[test]
fn bug_020_domain_detection_basic() {
    let p = parse_search_query("apple.com spending");
    assert_eq!(
        p.from_address.as_deref(),
        Some("apple.com"),
        "Should extract apple.com as from_address"
    );
    assert_eq!(
        p.query, "spending",
        "Should strip domain from query, leaving only 'spending'"
    );
}

/// BUG-020 fix: Domain detection respects explicit from: operator precedence.
/// Verify that explicit `from:` operator takes precedence over domain pattern.
#[test]
fn bug_020_domain_detection_explicit_from_takes_precedence() {
    let p = parse_search_query("from:alice@x.com OR apple.com");
    assert_eq!(
        p.from_address.as_deref(),
        Some("alice@x.com"),
        "Should prefer explicit from: operator over domain pattern"
    );
    // Note: domain "apple.com" is still stripped from query
    assert!(
        !p.query.contains("apple.com"),
        "Domain should be stripped even when from: takes precedence"
    );
}

/// BUG-020 fix: Domain-only query becomes filter-only.
/// Verify that "apple.com" alone becomes a pure from_address filter with empty query.
#[test]
fn bug_020_domain_detection_domain_only_query() {
    let p = parse_search_query("apple.com");
    assert_eq!(
        p.from_address.as_deref(),
        Some("apple.com"),
        "Should extract apple.com as from_address"
    );
    assert_eq!(
        p.query.trim(),
        "",
        "Query should be empty after stripping domain"
    );
}

/// BUG-020 fix: Integration test — domain in query now routes to fromAddress filter.
/// Verify that the query parsing fix enables "apple.com spending" to return all apple.com emails.
#[test]
fn bug_020_integration_domain_query_now_returns_results() {
    let conn = open_memory().unwrap();

    // Insert messages from apple.com
    insert_msg(
        &conn,
        "apple-m1@test",
        "receipt@apple.com",
        "Receipt",
        "Your purchase receipt.",
        "2025-03-01T10:00:00Z",
        1,
        None,
        "[]",
    );
    insert_msg(
        &conn,
        "apple-m2@test",
        "support@apple.com",
        "Shipping",
        "Your order is shipping.",
        "2025-03-05T14:30:00Z",
        2,
        None,
        "[]",
    );

    // Before fix: query "apple.com" would search FTS (0 results)
    // After fix: query "apple.com" extracts domain→fromAddress, returns 2 apple.com emails
    let search = search_with_meta(
        &conn,
        &SearchOptions {
            query: Some("apple.com".into()),
            limit: Some(50),
            ..Default::default()
        },
    )
    .unwrap();

    // After fix: should find both apple.com messages via domain→from routing
    assert_eq!(
        search.results.len(),
        2,
        "Domain-based query should now find all apple.com emails (got {})",
        search.results.len()
    );
    let ids: Vec<_> = search
        .results
        .iter()
        .map(|r| r.message_id.as_str())
        .collect();
    assert!(
        ids.contains(&"apple-m1@test"),
        "Missing apple-m1@test in {:?}",
        ids
    );
    assert!(
        ids.contains(&"apple-m2@test"),
        "Missing apple-m2@test in {:?}",
        ids
    );
}
