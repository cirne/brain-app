//! `search_with_meta` — regex pattern + SQL filters + contact-rank rerank.

use regex::{Regex, RegexBuilder};
use rusqlite::{params_from_iter, types::Value, Connection};

use super::contact_rank::{apply_contact_rank_rerank, RankedSearchRow};
use super::filter::{
    filter_clause_and_where_sql, filter_clause_with_where_prefix, sql_count_messages,
};
use super::query_parse::validate_search_pattern_no_legacy_operators;
use super::types::{SearchOptions, SearchResult, SearchResultSet, SearchTimings};
use crate::mime_decode::decode_rfc2047_header_line;

/// Hard cap on rows read from SQLite when applying a regex (safety).
const MAX_PATTERN_SCAN_ROWS: usize = 500_000;

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

/// No longer merges inline operators from the pattern string; [`SearchOptions`] fields are authoritative.
pub fn effective_search_options(opts: &SearchOptions) -> SearchOptions {
    opts.clone()
}

/// Set `query` from a rule string (pattern only). Prefer [`crate::rules::search_options_from_rule`].
pub fn effective_search_options_for_rule_query(
    base: &SearchOptions,
    query_raw: &str,
) -> SearchOptions {
    let mut opts = base.clone();
    opts.query = Some(query_raw.to_string());
    opts
}

fn compile_search_regex(pattern: &str, case_sensitive: bool) -> Result<Regex, String> {
    RegexBuilder::new(pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("invalid search pattern: {e}"))
}

fn haystack_mail(subject: &str, body: &str) -> String {
    format!("{subject}\n{body}")
}

fn snippet_for_match(haystack: &str, m: &regex::Match) -> String {
    // Match offsets are char boundaries, but `start - 25` / `end + 60` are byte offsets and can
    // land inside a multibyte codepoint (e.g. U+00A0 NBSP); slice only on char boundaries.
    let raw_start = m.start().saturating_sub(25);
    let raw_end = (m.end() + 60).min(haystack.len());
    let mut start = haystack.floor_char_boundary(raw_start);
    let mut end = haystack.floor_char_boundary(raw_end);
    if start >= end {
        start = haystack.floor_char_boundary(m.start());
        end = haystack.floor_char_boundary(m.end());
    }
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.push_str(&haystack[start..end]);
    if end < haystack.len() {
        out.push('…');
    }
    out
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

fn file_pattern_search_allowed(opts: &SearchOptions) -> bool {
    opts.from_address.is_none()
        && opts.to_address.is_none()
        && opts.subject.is_none()
        && opts.after_date.is_none()
        && opts.before_date.is_none()
        && opts.categories.is_empty()
}

fn combined_rank_for_date(iso_date: &str, base: f64) -> f64 {
    let normalized = iso_date.trim().replace(' ', "T");
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&normalized) else {
        return base;
    };
    let dt = dt.with_timezone(&chrono::Utc);
    let days_ago = (chrono::Utc::now() - dt).num_milliseconds() as f64 / 86400000.0;
    base - date_recency_boost_days_ago(days_ago)
}

/// Regex search over mail rows (filters in SQL; pattern in Rust).
fn regex_search_mail(
    conn: &Connection,
    opts: &SearchOptions,
    re: &Regex,
) -> rusqlite::Result<(Vec<RankedSearchRow>, i64)> {
    let (fc, where_clause) = filter_clause_with_where_prefix(opts, false);
    let sql = format!(
        "SELECT m.message_id, m.thread_id, m.source_id, m.from_address, m.from_name, m.subject, m.date, m.body_text
         FROM messages m
         {where_clause}
         ORDER BY m.date DESC"
    );

    let mut vals: Vec<Value> = fc.params.iter().cloned().map(Value::Text).collect();
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(vals.iter()))?;

    let mut matched: Vec<RankedSearchRow> = Vec::new();
    let mut scanned = 0usize;
    while let Some(row) = rows.next()? {
        scanned += 1;
        if scanned > MAX_PATTERN_SCAN_ROWS {
            break;
        }
        let subject: String = row.get(5)?;
        let body: String = row.get(7)?;
        let hay = haystack_mail(&subject, &body);
        if !re.is_match(&hay) {
            continue;
        }
        let m = re.find(&hay).unwrap();
        let snip = snippet_for_match(&hay, &m);
        let body_prev = if body.chars().count() > 300 {
            format!("{}…", body.chars().take(300).collect::<String>())
        } else {
            body.clone()
        };
        let date_s: String = row.get(6)?;
        let rank_v = 0.0_f64;
        let cr = combined_rank_for_date(&date_s, rank_v);
        matched.push(RankedSearchRow {
            result: row_from_cols(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                "mail".into(),
                row.get(3)?,
                row.get(4)?,
                subject,
                date_s,
                snip,
                body_prev,
                rank_v,
            ),
            combined_rank: cr,
        });
    }

    let total = matched.len() as i64;
    matched.sort_by(|a, b| {
        a.combined_rank
            .partial_cmp(&b.combined_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.result.date.cmp(&a.result.date))
    });
    Ok((matched, total))
}

/// Indexed local files: regex on title + path + body when mail-only filters are absent.
fn regex_search_files(
    conn: &Connection,
    opts: &SearchOptions,
    re: &Regex,
    sql_limit: i64,
) -> rusqlite::Result<(Vec<RankedSearchRow>, i64)> {
    if !file_pattern_search_allowed(opts) {
        return Ok((Vec::new(), 0));
    }

    let (src_clause, src_params) = match &opts.mailbox_ids {
        Some(ids) if !ids.is_empty() => {
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            (format!(" AND di.source_id IN ({ph})"), ids.clone())
        }
        _ => (String::new(), Vec::new()),
    };

    let sql = format!(
        "SELECT f.abs_path, f.source_id, di.title, di.date_iso, f.body_text, f.rel_path
         FROM files f
         JOIN document_index di ON di.source_id = f.source_id AND di.ext_id = f.rel_path AND di.kind = 'file'
         WHERE 1=1{src_clause}
         ORDER BY di.date_iso DESC
         LIMIT ?"
    );

    let mut vals: Vec<Value> = src_params.iter().cloned().map(Value::Text).collect();
    vals.push(Value::Integer(sql_limit));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(vals.iter()))?;

    let mut matched: Vec<RankedSearchRow> = Vec::new();
    while let Some(row) = rows.next()? {
        let abs_path: String = row.get(0)?;
        let source_id: String = row.get(1)?;
        let title: String = row.get(2)?;
        let date_iso: String = row.get(3)?;
        let body: String = row.get(4)?;
        let rel_path: String = row.get(5)?;
        let hay = format!("{title}\n{rel_path}\n{abs_path}\n{body}");
        if !re.is_match(&hay) {
            continue;
        }
        let m = re.find(&hay).unwrap();
        let snip = snippet_for_match(&hay, &m);
        let body_prev = if body.chars().count() > 300 {
            format!("{}…", body.chars().take(300).collect::<String>())
        } else {
            body.clone()
        };
        let rank_v = 0.0_f64;
        let cr = combined_rank_for_date(&date_iso, rank_v);
        matched.push(RankedSearchRow {
            result: row_from_cols(
                abs_path,
                String::new(),
                source_id,
                "localDir".into(),
                String::new(),
                None,
                title,
                date_iso,
                snip,
                body_prev,
                rank_v,
            ),
            combined_rank: cr,
        });
    }

    let total = matched.len() as i64;
    Ok((matched, total))
}

fn regex_search(
    conn: &Connection,
    opts: &SearchOptions,
) -> Result<(Vec<RankedSearchRow>, i64), String> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let re = compile_search_regex(q, opts.case_sensitive)?;
    let limit = opts.limit.unwrap_or(50);
    let offset = opts.offset;
    let sql_limit = MAX_PATTERN_SCAN_ROWS as i64;

    let (mut mail_rows, mail_total) =
        regex_search_mail(conn, opts, &re).map_err(|e| e.to_string())?;
    let (mut file_rows, file_total) = if file_pattern_search_allowed(opts) {
        regex_search_files(conn, opts, &re, sql_limit).map_err(|e| e.to_string())?
    } else {
        (Vec::new(), 0)
    };

    mail_rows.append(&mut file_rows);
    mail_rows.sort_by(|a, b| {
        a.combined_rank
            .partial_cmp(&b.combined_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.result.date.cmp(&a.result.date))
    });
    let total = mail_total.saturating_add(file_total);
    let results: Vec<RankedSearchRow> = mail_rows.into_iter().skip(offset).take(limit).collect();
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
            if let Err(msg) = validate_search_pattern_no_legacy_operators(t) {
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
                pattern_ms: None,
                total_ms: started.elapsed().as_millis() as u64,
            },
            total_matched: Some(total),
        });
    }

    let t0 = std::time::Instant::now();
    let (ranked, total) =
        regex_search(conn, &eff).map_err(rusqlite::Error::InvalidParameterName)?;
    let results = apply_contact_rank_rerank(
        conn,
        eff.owner_address.as_deref(),
        &eff.owner_aliases,
        ranked,
    )?;
    let pattern_ms = t0.elapsed().as_millis() as u64;

    Ok(SearchResultSet {
        results,
        timings: SearchTimings {
            pattern_ms: Some(pattern_ms),
            total_ms: started.elapsed().as_millis() as u64,
        },
        total_matched: Some(total),
    })
}

/// Count mail rows matching a regex pattern + filters (same semantics as search, no rerank).
pub fn count_regex_mail_matches(conn: &Connection, opts: &SearchOptions) -> Result<i64, String> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        return Ok(0);
    }
    validate_search_pattern_no_legacy_operators(q)?;
    let re = compile_search_regex(q, opts.case_sensitive)?;
    let (fc, where_clause) = filter_clause_with_where_prefix(opts, false);
    let sql = format!(
        "SELECT m.subject, m.body_text FROM messages m {where_clause} ORDER BY m.date DESC"
    );
    let mut vals: Vec<Value> = fc.params.iter().cloned().map(Value::Text).collect();
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(vals.iter()))
        .map_err(|e| e.to_string())?;
    let mut n = 0i64;
    let mut scanned = 0usize;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        scanned += 1;
        if scanned > MAX_PATTERN_SCAN_ROWS {
            break;
        }
        let subject: String = row.get(0).map_err(|e| e.to_string())?;
        let body: String = row.get(1).map_err(|e| e.to_string())?;
        let hay = haystack_mail(&subject, &body);
        if re.is_match(&hay) {
            n += 1;
        }
    }
    Ok(n)
}

/// Message ids (SQLite `messages.id`) matching pattern + filters + optional inbox scope (for rule assignment).
pub fn matching_message_row_ids_for_pattern(
    conn: &Connection,
    opts: &SearchOptions,
    inbox_inner_where: &str,
    inbox_params: &[Value],
) -> rusqlite::Result<Vec<i64>> {
    let q = opts.query.as_deref().unwrap_or("").trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    if let Err(e) = validate_search_pattern_no_legacy_operators(q) {
        return Err(rusqlite::Error::InvalidParameterName(e));
    }
    let re = compile_search_regex(q, opts.case_sensitive)
        .map_err(rusqlite::Error::InvalidParameterName)?;
    let (fc, where_sql) = filter_clause_and_where_sql(opts, false);
    let inner = if where_sql.is_empty() {
        inbox_inner_where.to_string()
    } else {
        format!("{inbox_inner_where} AND ({where_sql})")
    };
    let sql = format!(
        "SELECT m.id, m.subject, m.body_text FROM messages m WHERE {inner} ORDER BY m.date DESC"
    );
    let mut vals: Vec<Value> = inbox_params.to_vec();
    vals.extend(fc.params.iter().cloned().map(Value::Text));
    vals.extend(fc.always_and_params.iter().cloned().map(Value::Text));
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params_from_iter(vals.iter()))?;
    let mut out = Vec::new();
    let mut scanned = 0usize;
    while let Some(row) = rows.next()? {
        scanned += 1;
        if scanned > MAX_PATTERN_SCAN_ROWS {
            break;
        }
        let id: i64 = row.get(0)?;
        let subject: String = row.get(1)?;
        let body: String = row.get(2)?;
        let hay = haystack_mail(&subject, &body);
        if re.is_match(&hay) {
            out.push(id);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod snippet_tests {
    use super::snippet_for_match;
    use regex::Regex;

    #[test]
    fn snippet_for_match_when_context_window_splits_nbsp() {
        // 675 ASCII bytes, then U+00A0 (UTF-8 bytes 675..677), then 24 ASCII bytes, then "compass".
        // Match starts at byte 701; raw_start = 701 - 25 = 676 lands on the 2nd byte of NBSP (panic without floor_char_boundary).
        let hay = format!(
            "{}{}012345678901234567890123compass",
            "a".repeat(675),
            "\u{a0}"
        );
        let re = Regex::new("compass").unwrap();
        let m = re.find(&hay).expect("match");
        assert_eq!(m.start(), 701);
        let snip = snippet_for_match(&hay, &m);
        assert!(snip.contains("compass"), "snippet={snip:?}");
    }
}
