//! `search_with_meta` — FTS + filter-only paths + contact-rank rerank.

use rusqlite::{params_from_iter, types::Value, Connection};

use super::contact_rank::{apply_contact_rank_rerank, RankedSearchRow};
use super::escape::convert_to_or_query;
use super::filter::{
    filter_clause_with_where_prefix, sql_count_messages, sql_count_messages_fts_join,
};
use super::query_parse::{parse_search_query, validate_search_query_operators};
use super::types::{SearchOptions, SearchResult, SearchResultSet, SearchTimings};
use crate::mime_decode::decode_rfc2047_header_line;

fn date_recency_boost_days_ago(days_ago: f64) -> f64 {
    let d = days_ago.max(0.0);
    if d <= 1.0 {
        10.0
    } else if d <= 7.0 {
        8.0 - d * 0.5
    } else if d <= 30.0 {
        4.5 - (d - 7.0) * 0.1
    } else if d <= 90.0 {
        1.2 - (d - 30.0) * 0.01
    } else {
        0.6 - (d - 90.0) * 0.001
    }
}

fn filter_only_combined_rank(iso_date: &str) -> f64 {
    let normalized = iso_date.trim().replace(' ', "T");
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&normalized) else {
        return 0.0;
    };
    let dt = dt.with_timezone(&chrono::Utc);
    let days_ago = (chrono::Utc::now() - dt).num_milliseconds() as f64 / 86400000.0;
    -date_recency_boost_days_ago(days_ago)
}

/// Merge inline `from:` / `to:` / FTS remainder from `opts.query` (same as `ripmail search`).
pub fn effective_search_options(opts: &SearchOptions) -> SearchOptions {
    let mut e = opts.clone();
    if let Some(ref q) = opts.query {
        if !q.trim().is_empty() {
            let p = parse_search_query(q);
            if p.from_address.is_some() && e.from_address.is_none() {
                e.from_address = p.from_address;
            }
            if p.to_address.is_some() && e.to_address.is_none() {
                e.to_address = p.to_address;
            }
            if p.subject.is_some() && e.subject.is_none() {
                e.subject = p.subject;
            }
            if p.after_date.is_some() && e.after_date.is_none() {
                e.after_date = p.after_date;
            }
            if p.before_date.is_some() && e.before_date.is_none() {
                e.before_date = p.before_date;
            }
            if let Some(cat) = p.category.filter(|s| !s.trim().is_empty()) {
                e.categories = vec![cat.trim().to_ascii_lowercase()];
            }
            if let Some(fo) = p.filter_or {
                e.filter_or = fo;
            }
            if p.from_or_to_union {
                e.from_or_to_union = true;
            }
            e.query = Some(p.query);
        }
    }
    e
}

/// Merge `query_raw` into `base` and apply [`parse_search_query`] — the same path as `ripmail search`
/// with a query string. Used by rules validation and inbox rule assignment so `rules` and `search`
/// always share one compile path.
pub fn effective_search_options_for_rule_query(
    base: &SearchOptions,
    query_raw: &str,
) -> SearchOptions {
    let mut opts = base.clone();
    opts.query = Some(query_raw.to_string());
    effective_search_options(&opts)
}

#[allow(clippy::too_many_arguments)]
fn row_from_cols(
    message_id: String,
    thread_id: String,
    source_id: String,
    source_kind: String,
    from_address: String,
    from_name: Option<String>,
    subject: String,
    date: String,
    snippet: String,
    body_preview: String,
    rank: f64,
) -> SearchResult {
    SearchResult {
        message_id,
        thread_id,
        source_id,
        source_kind,
        from_address,
        from_name,
        subject: decode_rfc2047_header_line(&subject),
        date,
        snippet,
        body_preview,
        rank,
    }
}

fn filter_only_search(
    conn: &Connection,
    opts: &SearchOptions,
) -> rusqlite::Result<(Vec<RankedSearchRow>, i64)> {
    let (fc, where_clause) = filter_clause_with_where_prefix(opts, false);

    let count_sql = sql_count_messages(&where_clause);
    let mut count_vals: Vec<Value> = fc.params.iter().cloned().map(Value::Text).collect();
    count_vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    let total: i64 = if count_vals.is_empty() {
        conn.query_row(&count_sql, [], |r| r.get(0))?
    } else {
        conn.query_row(&count_sql, params_from_iter(count_vals.iter()), |r| {
            r.get(0)
        })?
    };

    let limit = opts.limit.unwrap_or(50);
    let offset = opts.offset;
    let sql_limit = limit + offset + 50;

    let body_prev = "COALESCE(TRIM(SUBSTR(m.body_text, 1, 300)), '') || (CASE WHEN LENGTH(TRIM(m.body_text)) > 300 THEN '…' ELSE '' END)";
    let sql = format!(
        "SELECT m.message_id, m.thread_id, m.source_id, m.from_address, m.from_name, m.subject, m.date,
                COALESCE(TRIM(SUBSTR(m.body_text, 1, 200)), '') || (CASE WHEN LENGTH(m.body_text) > 200 THEN '…' ELSE '' END),
                {body_prev}
         FROM messages m {where_clause}
         ORDER BY m.date DESC
         LIMIT ?"
    );

    let mut vals: Vec<Value> = fc.params.iter().cloned().map(Value::Text).collect();
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    vals.push(Value::Integer(sql_limit as i64));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(vals.iter()), |row| {
        Ok(row_from_cols(
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            "mail".into(),
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get::<_, String>(7)?,
            row.get(8)?,
            0.0,
        ))
    })?;

    let mut vec: Vec<RankedSearchRow> = rows
        .filter_map(|r| r.ok())
        .map(|r| {
            let cr = filter_only_combined_rank(&r.date);
            RankedSearchRow {
                result: r,
                combined_rank: cr,
            }
        })
        .collect();
    vec.sort_by(|a, b| {
        a.combined_rank
            .partial_cmp(&b.combined_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let results: Vec<RankedSearchRow> = vec.into_iter().skip(offset).take(limit).collect();
    Ok((results, total))
}

/// Keyword search on `localDir` files does not support mail-only filters (`from:`, categories, etc.).
fn file_keyword_search_allowed(opts: &SearchOptions) -> bool {
    opts.from_address.is_none()
        && opts.to_address.is_none()
        && opts.subject.is_none()
        && opts.after_date.is_none()
        && opts.before_date.is_none()
        && opts.categories.is_empty()
}

fn fts_search_files(
    conn: &Connection,
    opts: &SearchOptions,
    escaped: &str,
    sql_limit: i64,
) -> rusqlite::Result<(Vec<RankedSearchRow>, i64)> {
    if !file_keyword_search_allowed(opts) {
        return Ok((Vec::new(), 0));
    }

    let (src_clause, src_params) = match &opts.mailbox_ids {
        Some(ids) if !ids.is_empty() => {
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            (format!(" AND di.source_id IN ({ph})"), ids.clone())
        }
        _ => (String::new(), Vec::new()),
    };

    let mut count_vals: Vec<Value> = vec![Value::Text(escaped.to_string())];
    count_vals.extend(src_params.iter().cloned().map(Value::Text));
    let count_sql = format!(
        "SELECT COUNT(*) FROM document_index_fts \
         JOIN document_index di ON di.id = document_index_fts.rowid \
         WHERE document_index_fts MATCH ? AND di.kind = 'file'{src_clause}"
    );
    let file_total: i64 = conn.query_row(&count_sql, params_from_iter(count_vals.iter()), |r| {
        r.get(0)
    })?;

    let body_prev = "COALESCE(TRIM(SUBSTR(f.body_text, 1, 300)), '') || (CASE WHEN LENGTH(TRIM(f.body_text)) > 300 THEN '…' ELSE '' END)";
    let sql = format!(
        "SELECT f.abs_path, f.source_id, di.title, di.date_iso,
                snippet(document_index_fts, 1, '<b>', '</b>', '…', 20),
                {body_prev},
                rank,
                rank AS combined_rank
         FROM document_index_fts
         JOIN document_index di ON di.id = document_index_fts.rowid
         JOIN files f ON f.source_id = di.source_id AND f.rel_path = di.ext_id
         WHERE document_index_fts MATCH ? AND di.kind = 'file'{src_clause}
         ORDER BY combined_rank ASC, di.date_iso DESC
         LIMIT ?"
    );

    let mut vals: Vec<Value> = vec![Value::Text(escaped.to_string())];
    vals.extend(src_params.iter().cloned().map(Value::Text));
    vals.push(Value::Integer(sql_limit));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(vals.iter()), |row| {
        let snip: Option<String> = row.get(4)?;
        let rank_v: f64 = row.get(6)?;
        let cr: f64 = row.get(7)?;
        Ok(RankedSearchRow {
            result: row_from_cols(
                row.get(0)?,
                String::new(),
                row.get(1)?,
                "localDir".into(),
                String::new(),
                None,
                row.get(2)?,
                row.get(3)?,
                snip.unwrap_or_default(),
                row.get(5)?,
                rank_v,
            ),
            combined_rank: cr,
        })
    })?;

    let mut vec: Vec<RankedSearchRow> = rows.filter_map(|r| r.ok()).collect();
    vec.sort_by(|a, b| {
        a.combined_rank
            .partial_cmp(&b.combined_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.result.date.cmp(&a.result.date))
    });
    Ok((vec, file_total))
}

fn fts_search(
    conn: &Connection,
    opts: &SearchOptions,
) -> rusqlite::Result<(Vec<RankedSearchRow>, i64)> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let escaped = convert_to_or_query(q);
    let (fc, where_clause) = filter_clause_with_where_prefix(opts, true);

    let mut count_vals: Vec<Value> = vec![Value::Text(escaped.clone())];
    count_vals.extend(fc.params.iter().cloned().map(Value::Text));
    count_vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));

    let count_sql = sql_count_messages_fts_join(&where_clause);
    let mail_total: i64 = conn.query_row(&count_sql, params_from_iter(count_vals.iter()), |r| {
        r.get(0)
    })?;

    let limit = opts.limit.unwrap_or(50);
    let offset = opts.offset;
    let sql_limit = limit + offset + 50;

    let days_ago = "julianday('now') - julianday(m.date)";
    let date_boost = format!(
        "CASE 
        WHEN {days_ago} <= 1 THEN 10.0
        WHEN {days_ago} <= 7 THEN 8.0 - ({days_ago} * 0.5)
        WHEN {days_ago} <= 30 THEN 4.5 - (({days_ago} - 7) * 0.1)
        WHEN {days_ago} <= 90 THEN 1.2 - (({days_ago} - 30) * 0.01)
        ELSE 0.6 - (({days_ago} - 90) * 0.001)
        END"
    );
    let body_prev = "COALESCE(TRIM(SUBSTR(m.body_text, 1, 300)), '') || (CASE WHEN LENGTH(TRIM(m.body_text)) > 300 THEN '…' ELSE '' END)";

    let sql = format!(
        "SELECT m.message_id, m.thread_id, m.source_id, m.from_address, m.from_name, m.subject, m.date,
                snippet(document_index_fts, 1, '<b>', '</b>', '…', 20),
                {body_prev},
                rank,
                (rank - ({date_boost})) AS combined_rank
         FROM document_index_fts
         JOIN document_index di ON di.id = document_index_fts.rowid
         JOIN messages m ON m.message_id = di.ext_id AND di.kind = 'mail'
         {where_clause}
         ORDER BY combined_rank ASC, m.date DESC
         LIMIT ?"
    );

    let mut vals: Vec<Value> = vec![Value::Text(escaped.clone())];
    vals.extend(fc.params.iter().cloned().map(Value::Text));
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    vals.push(Value::Integer(sql_limit as i64));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(vals.iter()), |row| {
        let snip: Option<String> = row.get(7)?;
        let rank_v: f64 = row.get(9)?;
        let cr: f64 = row.get(10)?;
        Ok(RankedSearchRow {
            result: row_from_cols(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                "mail".into(),
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                snip.unwrap_or_default(),
                row.get(8)?,
                rank_v,
            ),
            combined_rank: cr,
        })
    })?;

    let mut vec: Vec<RankedSearchRow> = rows.filter_map(|r| r.ok()).collect();
    vec.sort_by(|a, b| {
        a.combined_rank
            .partial_cmp(&b.combined_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.result.date.cmp(&a.result.date))
    });
    let (mut file_rows, file_total) = fts_search_files(conn, opts, &escaped, sql_limit as i64)?;
    vec.append(&mut file_rows);
    vec.sort_by(|a, b| {
        a.combined_rank
            .partial_cmp(&b.combined_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.result.date.cmp(&a.result.date))
    });
    let total = mail_total.saturating_add(file_total);
    let results: Vec<RankedSearchRow> = vec.into_iter().skip(offset).take(limit).collect();
    Ok((results, total))
}

/// Main entry (sync API).
pub fn search_with_meta(
    conn: &Connection,
    opts: &SearchOptions,
) -> rusqlite::Result<SearchResultSet> {
    let started = std::time::Instant::now();
    if let Some(ref raw) = opts.query {
        let t = raw.trim();
        if !t.is_empty() {
            if let Err(msg) = validate_search_query_operators(t) {
                return Err(rusqlite::Error::InvalidParameterName(msg));
            }
        }
    }
    let eff = effective_search_options(opts);
    let q = eff.query.as_deref().unwrap_or("").trim();

    if q.is_empty() {
        let (ranked, total) = filter_only_search(conn, &eff)?;
        let results = apply_contact_rank_rerank(
            conn,
            eff.owner_address.as_deref(),
            &eff.owner_aliases,
            ranked,
        )?;
        return Ok(SearchResultSet {
            results,
            timings: SearchTimings {
                fts_ms: None,
                total_ms: started.elapsed().as_millis() as u64,
            },
            total_matched: Some(total),
        });
    }

    let t0 = std::time::Instant::now();
    let (ranked, total) = fts_search(conn, &eff).map_err(|e| {
        let s = e.to_string();
        if s.contains("fts5:") || s.contains("syntax error") {
            rusqlite::Error::InvalidParameterName(format!(
                "Search syntax error (FTS). Try removing or quoting special characters (& * ^ + ( ) \"); use simpler keywords. ({s})"
            ))
        } else {
            e
        }
    })?;
    let results = apply_contact_rank_rerank(
        conn,
        eff.owner_address.as_deref(),
        &eff.owner_aliases,
        ranked,
    )?;
    let fts_ms = t0.elapsed().as_millis() as u64;

    Ok(SearchResultSet {
        results,
        timings: SearchTimings {
            fts_ms: Some(fts_ms),
            total_ms: started.elapsed().as_millis() as u64,
        },
        total_matched: Some(total),
    })
}
