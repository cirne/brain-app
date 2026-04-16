//! WHERE builder (mirrors `src/search/filter-compiler.ts`).

use super::types::SearchOptions;
use crate::mail_category::default_category_filter_sql;

pub struct FilterClause {
    pub conditions: Vec<String>,
    pub params: Vec<String>,
    pub use_or: bool,
    pub always_and: Vec<String>,
    pub always_and_params: Vec<String>,
}

fn from_pattern(p: &str) -> String {
    format!("%{}%", p.to_lowercase())
}

pub fn build_filter_clause(opts: &SearchOptions, include_fts: bool) -> FilterClause {
    let mut conditions = Vec::new();
    let mut params = Vec::new();

    if include_fts {
        conditions.push("messages_fts MATCH ?".to_string());
    }

    let mut from_to_handled = false;
    if opts.from_or_to_union {
        if let (Some(ref fa), Some(ref ta)) = (&opts.from_address, &opts.to_address) {
            let pf = from_pattern(fa);
            let pt = from_pattern(ta);
            let from_part = "(m.from_address LIKE ? OR m.from_name LIKE ?)";
            let to_part = "(EXISTS (SELECT 1 FROM json_each(m.to_addresses) j WHERE LOWER(j.value) LIKE LOWER(?)) OR EXISTS (SELECT 1 FROM json_each(m.cc_addresses) j WHERE LOWER(j.value) LIKE LOWER(?)))";
            let cond = format!("({from_part} OR {to_part})");
            conditions.push(if opts.filter_or {
                format!("({cond})")
            } else {
                cond
            });
            params.push(pf.clone());
            params.push(pf);
            params.push(pt.clone());
            params.push(pt);
            from_to_handled = true;
        }
    }

    if !from_to_handled {
        if let Some(ref a) = opts.from_address {
            let p = from_pattern(a);
            let cond = "(m.from_address LIKE ? OR m.from_name LIKE ?)";
            conditions.push(if opts.filter_or {
                format!("({cond})")
            } else {
                cond.to_string()
            });
            params.push(p.clone());
            params.push(p);
        }

        if let Some(ref a) = opts.to_address {
            let p = from_pattern(a);
            let cond = "(EXISTS (SELECT 1 FROM json_each(m.to_addresses) j WHERE LOWER(j.value) LIKE LOWER(?)) OR EXISTS (SELECT 1 FROM json_each(m.cc_addresses) j WHERE LOWER(j.value) LIKE LOWER(?)))";
            conditions.push(if opts.filter_or {
                format!("({cond})")
            } else {
                cond.to_string()
            });
            params.push(p.clone());
            params.push(p);
        }
    }

    if let Some(ref s) = opts.subject {
        let p = from_pattern(s);
        let cond = "m.subject LIKE ?";
        conditions.push(if opts.filter_or {
            format!("({cond})")
        } else {
            cond.to_string()
        });
        params.push(p);
    }

    if let Some(ref d) = opts.after_date {
        let cond = "m.date >= ?";
        conditions.push(if opts.filter_or {
            format!("({cond})")
        } else {
            cond.to_string()
        });
        params.push(d.clone());
    }

    if let Some(ref d) = opts.before_date {
        let cond = "m.date <= ?";
        conditions.push(if opts.filter_or {
            format!("({cond})")
        } else {
            cond.to_string()
        });
        let bound = if d.len() == 10 {
            format!("{d}T23:59:59.999Z")
        } else {
            d.clone()
        };
        params.push(bound);
    }

    let mut always_and = Vec::new();
    let mut always_and_params = Vec::new();
    if !opts.categories.is_empty() {
        let placeholders = opts
            .categories
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");
        always_and.push(format!(
            "LOWER(COALESCE(m.category, '')) IN ({placeholders})"
        ));
        always_and_params.extend(opts.categories.iter().map(|c| c.to_ascii_lowercase()));
    } else if !opts.include_all {
        always_and.push(default_category_filter_sql("m.category"));
    }

    if let Some(ref ids) = opts.mailbox_ids {
        if !ids.is_empty() {
            let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            always_and.push(format!("m.mailbox_id IN ({placeholders})"));
            always_and_params.extend(ids.iter().cloned());
        }
    }

    FilterClause {
        conditions,
        params,
        use_or: opts.filter_or,
        always_and,
        always_and_params,
    }
}

/// [`FilterClause`] and the inner `WHERE` predicate (no `WHERE` keyword) — for nesting in rule `UPDATE` subqueries.
pub fn filter_clause_and_where_sql(
    opts: &SearchOptions,
    include_fts: bool,
) -> (FilterClause, String) {
    let fc = build_filter_clause(opts, include_fts);
    let where_sql = build_where_sql(&fc);
    (fc, where_sql)
}

/// Build [`FilterClause`] plus a `WHERE …` fragment (or `""`) for `messages` / `messages_fts` queries.
/// Shared by `search_with_meta` and rule membership (same predicates).
pub fn filter_clause_with_where_prefix(
    opts: &SearchOptions,
    include_fts: bool,
) -> (FilterClause, String) {
    let (fc, where_sql) = filter_clause_and_where_sql(opts, include_fts);
    let where_clause = if where_sql.is_empty() {
        String::new()
    } else {
        format!("WHERE {where_sql}")
    };
    (fc, where_clause)
}

/// `SELECT COUNT(*)` over `messages m` with optional `WHERE` (filter-only search / rule counts).
pub fn sql_count_messages(where_clause: &str) -> String {
    format!("SELECT COUNT(*) FROM messages m {where_clause}")
}

/// `SELECT COUNT(*)` over `messages_fts` ⋈ `messages` (FTS search / rule counts).
pub fn sql_count_messages_fts_join(where_clause: &str) -> String {
    format!("SELECT COUNT(*) FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid {where_clause}")
}

pub fn build_where_sql(clause: &FilterClause) -> String {
    if clause.conditions.is_empty() && clause.always_and.is_empty() {
        return String::new();
    }
    let mut parts = Vec::new();
    if !clause.conditions.is_empty() {
        let join = if clause.use_or { " OR " } else { " AND " };
        let main = clause.conditions.join(join);
        if clause.use_or && !clause.always_and.is_empty() {
            parts.push(format!("({main})"));
        } else {
            parts.push(main);
        }
    }
    parts.extend(clause.always_and.clone());
    parts.join(" AND ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_only_minimal() {
        let opts = SearchOptions::default();
        let c = build_filter_clause(&opts, true);
        assert_eq!(c.conditions.len(), 1);
        assert!(c.conditions[0].contains("MATCH"));
        assert!(c.params.is_empty());
    }

    #[test]
    fn from_adds_like_params() {
        let opts = SearchOptions {
            from_address: Some("alice@x.com".into()),
            ..Default::default()
        };
        let c = build_filter_clause(&opts, false);
        assert!(c.conditions.iter().any(|s| s.contains("from_address")));
        assert_eq!(c.params.len(), 2);
        assert!(c.params[0].contains("alice"));
    }

    #[test]
    fn before_date_extends_end_of_day() {
        let opts = SearchOptions {
            before_date: Some("2024-06-01".into()),
            ..Default::default()
        };
        let c = build_filter_clause(&opts, false);
        assert!(c.params.iter().any(|p| p.contains("T23:59:59")));
    }

    #[test]
    fn build_where_and_vs_or() {
        let mut clause = FilterClause {
            conditions: vec!["a = 1".into(), "b = 2".into()],
            params: vec![],
            use_or: false,
            always_and: vec!["c = 3".into()],
            always_and_params: vec![],
        };
        assert_eq!(build_where_sql(&clause), "a = 1 AND b = 2 AND c = 3");
        clause.use_or = true;
        let w = build_where_sql(&clause);
        assert!(w.contains("(a = 1 OR b = 2)"));
        assert!(w.contains("AND c = 3"));
    }

    #[test]
    fn include_all_skips_default_category_clause() {
        let opts = SearchOptions {
            include_all: true,
            ..Default::default()
        };
        let c = build_filter_clause(&opts, false);
        assert!(c.always_and.is_empty());
    }

    #[test]
    fn category_filter_adds_always_and_params() {
        let opts = SearchOptions {
            categories: vec!["social".into(), "promotional".into()],
            ..Default::default()
        };
        let c = build_filter_clause(&opts, false);
        assert_eq!(c.always_and_params.len(), 2);
        assert!(c.always_and[0].contains("m.category"));
    }
}
