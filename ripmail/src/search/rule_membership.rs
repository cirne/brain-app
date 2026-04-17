//! Inbox rule evaluation: same WHERE/MATCH as `search_with_meta`, scoped to pending rows + inbox window.

use rusqlite::{params_from_iter, types::Value, Connection};

use super::engine::effective_search_options_for_rule_query;
use super::escape::convert_to_or_query;
use super::filter::{
    filter_clause_and_where_sql, filter_clause_with_where_prefix, sql_count_messages,
    sql_count_messages_fts_join,
};
use super::types::SearchOptions;

/// Count messages matching a rule `query` string with the same semantics as `ripmail search`
/// (no contact rerank). Used by `ripmail rules validate --sample`.
pub fn count_messages_matching_rule_query(
    conn: &Connection,
    query_raw: &str,
    base: &SearchOptions,
) -> rusqlite::Result<i64> {
    let eff = effective_search_options_for_rule_query(base, query_raw);
    let q = eff.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        count_filter_only(conn, &eff)
    } else {
        count_fts(conn, &eff)
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

fn count_fts(conn: &Connection, opts: &SearchOptions) -> rusqlite::Result<i64> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        return Ok(0);
    }
    let escaped = convert_to_or_query(q);
    let (fc, where_clause) = filter_clause_with_where_prefix(opts, true);
    let mut vals: Vec<Value> = vec![Value::Text(escaped)];
    vals.extend(fc.params.iter().cloned().map(Value::Text));
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    let sql = sql_count_messages_fts_join(&where_clause);
    conn.query_row(&sql, params_from_iter(vals.iter()), |r| r.get(0))
}

/// `UPDATE messages SET rule_triage = 'assigned', winning_rule_id = ? WHERE pending AND inbox_scope AND search_predicate`.
/// Returns number of rows updated.
pub fn assign_pending_matching_rule_query(
    conn: &Connection,
    query_raw: &str,
    base: &SearchOptions,
    winning_rule_id: &str,
    inbox_scope_sql: &str,
    inbox_scope_params: &[Value],
) -> rusqlite::Result<usize> {
    let eff = effective_search_options_for_rule_query(base, query_raw);
    let q = eff.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        update_filter_only(
            conn,
            &eff,
            winning_rule_id,
            inbox_scope_sql,
            inbox_scope_params,
        )
    } else {
        update_fts(
            conn,
            &eff,
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

fn update_fts(
    conn: &Connection,
    opts: &SearchOptions,
    winning_rule_id: &str,
    inbox_scope_sql: &str,
    inbox_scope_params: &[Value],
) -> rusqlite::Result<usize> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        return Ok(0);
    }
    let escaped = convert_to_or_query(q);
    let (fc, where_sql) = filter_clause_and_where_sql(opts, true);
    let inner_where = if where_sql.is_empty() {
        format!("m.rule_triage = 'pending' {inbox_scope_sql}")
    } else {
        format!("m.rule_triage = 'pending' {inbox_scope_sql} AND ({where_sql})")
    };
    // Same WHERE/MATCH order as `count_fts` / `fts_search` (single MATCH via build_filter_clause).
    let sql = format!(
        "UPDATE messages SET rule_triage = 'assigned', winning_rule_id = ?1
         WHERE id IN (
           SELECT m.id FROM document_index_fts
           JOIN document_index di ON di.id = document_index_fts.rowid
           JOIN messages m ON m.message_id = di.ext_id AND di.kind = 'mail'
           WHERE {inner_where}
         )"
    );
    let mut vals: Vec<Value> = vec![Value::Text(winning_rule_id.to_string())];
    vals.extend(inbox_scope_params.iter().cloned());
    vals.push(Value::Text(escaped));
    vals.extend(fc.params.iter().cloned().map(Value::Text));
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    conn.execute(&sql, params_from_iter(vals.iter()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_memory;
    use crate::persist_message;
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
        let q = "(from:dad@example.com OR to:dad@example.com) golf";
        let base = SearchOptions::default();
        let cnt = count_messages_matching_rule_query(&conn, q, &base).unwrap();
        let set = search_with_meta(
            &conn,
            &SearchOptions {
                query: Some(q.into()),
                limit: Some(20),
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
        let c = count_messages_matching_rule_query(&conn, "from:x@y.com", &base).unwrap();
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
        let n = assign_pending_matching_rule_query(&conn, "from:x@y.com", &base, "r1", "", &[])
            .unwrap();
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
