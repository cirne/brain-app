//! Inbox rule evaluation: same predicates as `search_with_meta`, scoped to pending rows + inbox window.

use rusqlite::{params_from_iter, types::Value, Connection};

use super::engine::{count_regex_mail_matches, matching_message_row_ids_for_pattern};
use super::filter::{
    filter_clause_and_where_sql, filter_clause_with_where_prefix, sql_count_messages,
};
use super::types::SearchOptions;

/// Count messages matching rule [`SearchOptions`] (no contact rerank). Used by `ripmail rules validate --sample`.
pub fn count_messages_matching_rule_query(
    conn: &Connection,
    opts: &SearchOptions,
) -> rusqlite::Result<i64> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        count_filter_only(conn, opts)
    } else {
        count_regex_mail_matches(conn, opts).map_err(rusqlite::Error::InvalidParameterName)
    }
}

fn count_filter_only(conn: &Connection, opts: &SearchOptions) -> rusqlite::Result<i64> {
    let (fc, where_clause) = filter_clause_with_where_prefix(opts, false);
    let sql = sql_count_messages(&where_clause);
    let mut vals: Vec<Value> = fc.params.iter().cloned().map(Value::Text).collect();
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    if vals.is_empty() {
        conn.query_row(&sql, [], |r| r.get(0))
    } else {
        conn.query_row(&sql, params_from_iter(vals.iter()), |r| r.get(0))
    }
}

/// `UPDATE messages SET rule_triage = 'assigned', winning_rule_id = ? WHERE pending AND inbox_scope AND search_predicate`.
/// Returns number of rows updated.
pub fn assign_pending_matching_rule_query(
    conn: &Connection,
    opts: &SearchOptions,
    winning_rule_id: &str,
    inbox_scope_sql: &str,
    inbox_scope_params: &[Value],
) -> rusqlite::Result<usize> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        update_filter_only(
            conn,
            opts,
            winning_rule_id,
            inbox_scope_sql,
            inbox_scope_params,
        )
    } else {
        update_regex(
            conn,
            opts,
            winning_rule_id,
            inbox_scope_sql,
            inbox_scope_params,
        )
    }
}

fn update_filter_only(
    conn: &Connection,
    opts: &SearchOptions,
    winning_rule_id: &str,
    inbox_scope_sql: &str,
    inbox_scope_params: &[Value],
) -> rusqlite::Result<usize> {
    let (fc, where_sql) = filter_clause_and_where_sql(opts, false);
    let inner_where = if where_sql.is_empty() {
        format!("m.rule_triage = 'pending' {inbox_scope_sql}")
    } else {
        format!("m.rule_triage = 'pending' {inbox_scope_sql} AND ({where_sql})")
    };
    let sql = format!(
        "UPDATE messages SET rule_triage = 'assigned', winning_rule_id = ?1
         WHERE id IN (
           SELECT m.id FROM messages m
           WHERE {inner_where}
         )"
    );
    let mut vals: Vec<Value> = vec![Value::Text(winning_rule_id.to_string())];
    vals.extend(inbox_scope_params.iter().cloned());
    vals.extend(fc.params.iter().cloned().map(Value::Text));
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    conn.execute(&sql, params_from_iter(vals.iter()))
}

fn update_regex(
    conn: &Connection,
    opts: &SearchOptions,
    winning_rule_id: &str,
    inbox_scope_sql: &str,
    inbox_scope_params: &[Value],
) -> rusqlite::Result<usize> {
    let inner = format!("m.rule_triage = 'pending' {inbox_scope_sql}");
    let ids = matching_message_row_ids_for_pattern(conn, opts, &inner, inbox_scope_params)?;
    if ids.is_empty() {
        return Ok(0);
    }
    let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "UPDATE messages SET rule_triage = 'assigned', winning_rule_id = ?1 WHERE id IN ({ph})"
    );
    let mut vals: Vec<Value> = vec![Value::Text(winning_rule_id.to_string())];
    vals.extend(ids.iter().map(|i| Value::Integer(*i)));
    conn.execute(&sql, params_from_iter(vals.iter()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;
    use crate::persist_message;
    use crate::rules::search_options_from_rule;
    use crate::rules::UserRule;
    use crate::search_with_meta;
    use crate::ParsedMessage;

    const MAILBOX: &str = "[Gmail]/All Mail";

    #[test]
    fn rule_count_matches_search_from_or_to_union() {
        let conn = open_memory().unwrap();
        let ins = |mid: &str, from: &str, to_json: &str, body: &str, uid: i64| {
            let p = ParsedMessage {
                message_id: mid.into(),
                from_address: from.into(),
                from_name: None,
                to_addresses: serde_json::from_str(to_json).unwrap_or_default(),
                cc_addresses: vec![],
                to_recipients: vec![],
                cc_recipients: vec![],
                subject: "s".into(),
                date: "2025-03-01T12:00:00Z".into(),
                body_text: body.into(),
                body_html: None,
                attachments: vec![],
                category: None,
                ..Default::default()
            };
            persist_message(&conn, &p, MAILBOX, "", uid, "[]", "x.eml").unwrap();
        };
        ins(
            "parity-from@test",
            "dad@example.com",
            r#"["o@example.com"]"#,
            "weekend golf",
            1,
        );
        ins(
            "parity-to@test",
            "o@example.com",
            r#"["dad@example.com"]"#,
            "tee time and golf",
            2,
        );
        let rule = UserRule::Search {
            id: "r".into(),
            action: "ignore".into(),
            query: "golf".into(),
            from_address: Some("dad@example.com".into()),
            to_address: Some("dad@example.com".into()),
            subject: None,
            category: None,
            from_or_to_union: true,
            description: None,
        };
        let base = SearchOptions::default();
        let opts = search_options_from_rule(&rule, &base);
        let cnt = count_messages_matching_rule_query(&conn, &opts).unwrap();
        let set = search_with_meta(
            &conn,
            &SearchOptions {
                query: Some("golf".into()),
                limit: Some(20),
                from_address: Some("dad@example.com".into()),
                to_address: Some("dad@example.com".into()),
                from_or_to_union: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(cnt, set.total_matched.unwrap());
        assert_eq!(cnt, 2);
    }

    #[test]
    fn count_filter_only_matches_search() {
        let conn = open_memory().unwrap();
        conn.execute(
            "INSERT INTO messages (message_id, thread_id, folder, uid, labels, from_address, to_addresses, cc_addresses, subject, body_text, date, raw_path)
             VALUES ('<a@test>', '<a@test>', 'INBOX', 1, '[]', 'x@y.com', '[]', '[]', 'sub', 'hello body', '2026-01-01T00:00:00Z', 'p')",
            [],
        ).unwrap();
        let base = SearchOptions::default();
        let rule = UserRule::Search {
            id: "r".into(),
            action: "ignore".into(),
            query: "".into(),
            from_address: Some("x@y.com".into()),
            to_address: None,
            subject: None,
            category: None,
            from_or_to_union: false,
            description: None,
        };
        let opts = search_options_from_rule(&rule, &base);
        let c = count_messages_matching_rule_query(&conn, &opts).unwrap();
        assert_eq!(c, 1);
    }

    #[test]
    fn assign_pending_updates_row() {
        let conn = open_memory().unwrap();
        conn.execute(
            "INSERT INTO messages (message_id, thread_id, folder, uid, labels, from_address, to_addresses, cc_addresses, subject, body_text, date, raw_path)
             VALUES ('<a@test>', '<a@test>', 'INBOX', 1, '[]', 'x@y.com', '[]', '[]', 'sub', 'needle', '2026-01-01T00:00:00Z', 'p')",
            [],
        ).unwrap();
        let base = SearchOptions::default();
        let rule = UserRule::Search {
            id: "r1".into(),
            action: "ignore".into(),
            query: "".into(),
            from_address: Some("x@y.com".into()),
            to_address: None,
            subject: None,
            category: None,
            from_or_to_union: false,
            description: None,
        };
        let opts = search_options_from_rule(&rule, &base);
        let n = assign_pending_matching_rule_query(&conn, &opts, "r1", "", &[]).unwrap();
        assert_eq!(n, 1);
        let (triage, wr): (String, Option<String>) = conn
            .query_row(
                "SELECT rule_triage, winning_rule_id FROM messages WHERE message_id = '<a@test>'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(triage, "assigned");
        assert_eq!(wr.as_deref(), Some("r1"));
    }
}
