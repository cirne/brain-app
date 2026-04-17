//! Inline operators (mirrors `src/search/query-parse.ts`).

use crate::parse_since_to_date;
use regex::Regex;
use std::sync::LazyLock;

/// Stop before `)` so `(from:x OR to:y)` does not swallow the group-closing `)` (BUG-037).
static RE_FROM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bfrom:([^)\s]+)").unwrap());
static RE_TO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bto:([^)\s]+)").unwrap());
/// `subject:"multi word"` / `subject:'multi word'` — quoted first so agents can pass phrases.
static RE_SUBJ_QUOTED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bsubject:"([^"]*)""#).unwrap());
static RE_SUBJ_QUOTED_SINGLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bsubject:'([^']*)'").unwrap());
/// Unquoted value: must not start with `"` (avoids swallowing `subject:"VIP` from broken input).
static RE_SUBJ: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bsubject:([^\x22\s]\S*)").unwrap());
static RE_AFTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bafter:(\S+)").unwrap());
static RE_BEFORE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bbefore:(\S+)").unwrap());
static RE_CATEGORY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bcategory:(\S+)").unwrap());
/// `from:x OR to:y` or `(from:x OR to:y)` — OR semantics across address filters (BUG-037).
static RE_FROM_OR_TO_UNION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:\(\s*)?from:\S+\s+OR\s+to:\S+(?:\s*\)|\s|$)|(?:\(\s*)?to:\S+\s+OR\s+from:\S+(?:\s*\)|\s|$)",
    )
    .unwrap()
});
static RE_ISO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap());
/// Remove `@` left behind when `RE_DOMAIN` stripped `domain.tld` from `@domain.tld` (FTS5 rejects bare `@`).
static RE_STRAY_AT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:^|\s)@(?:\s|$)").unwrap());
/// Domain pattern: word.tld or word.word.tld (e.g., apple.com, mail.example.com).
/// Requires at least one dot and valid domain characters (alphanumeric + hyphens).
/// Used to auto-route domain queries to fromAddress filter (BUG-020).
static RE_DOMAIN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)\b")
        .unwrap()
});

/// `foo:` at a word boundary is treated as an inline operator (no longer supported — use CLI flags).
static RE_OPERATOR_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b([a-z][a-z0-9]{0,63}):").unwrap());
/// URL schemes in prose should not be treated as operators.
const SKIP_OPERATOR_NAMES: &[&str] = &["http", "https", "mailto", "ftp"];

/// Reject `word:` tokens in the pattern string; metadata belongs in `ripmail search` flags, not the pattern.
pub fn validate_search_pattern_no_legacy_operators(raw: &str) -> Result<(), String> {
    for cap in RE_OPERATOR_TOKEN.captures_iter(raw) {
        let name = cap.get(1).unwrap().as_str().to_ascii_lowercase();
        if SKIP_OPERATOR_NAMES.contains(&name.as_str()) {
            continue;
        }
        return Err(format!(
            "Pattern must not contain `{name}:` — use `ripmail search` flags (--from, --to, --subject, --after, --before, --category) instead of inline operators. See `ripmail search --help`."
        ));
    }
    Ok(())
}

/// Alias for [`validate_search_pattern_no_legacy_operators`] (tests / external callers).
#[allow(dead_code)]
pub fn validate_search_query_operators(raw: &str) -> Result<(), String> {
    validate_search_pattern_no_legacy_operators(raw)
}

#[derive(Debug, Default, Clone)]
pub struct ParsedSearchQuery {
    pub query: String,
    pub from_address: Option<String>,
    pub to_address: Option<String>,
    pub subject: Option<String>,
    pub after_date: Option<String>,
    pub before_date: Option<String>,
    /// Single category label (matches `messages.category`, lowercased in SQL).
    pub category: Option<String>,
    /// True when the raw query uses OR between `from:` and `to:` (either order, optional parens).
    pub from_or_to_union: bool,
    pub filter_or: Option<bool>,
}

/// Drop a single outer `( … )` when depth inside is balanced (e.g. `(golf OR "tee time")` → FTS-safe).
fn strip_outer_paren_group_if_redundant(s: &str) -> String {
    let t = s.trim();
    if !t.starts_with('(') || !t.ends_with(')') {
        return t.to_string();
    }
    let inner = &t[1..t.len() - 1];
    let mut depth = 0i32;
    for c in inner.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if depth < 0 {
            return t.to_string();
        }
    }
    if depth == 0 {
        inner.trim().to_string()
    } else {
        t.to_string()
    }
}

fn try_parse_date(value: &str) -> Option<String> {
    normalize_search_date_spec(value).ok()
}

/// Normalize CLI `--after` / `--since` / `--before` values: `YYYY-MM-DD` or a rolling spec (`7d`, `1y`, …) like inline `after:` / `before:` in queries.
pub fn normalize_search_date_spec(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("date must not be empty".to_string());
    }
    if RE_ISO.is_match(trimmed) {
        return Ok(trimmed.to_string());
    }
    parse_since_to_date(trimmed)
}

/// Strip `key:value` operators; remainder is FTS query.
pub fn parse_search_query(raw: &str) -> ParsedSearchQuery {
    let mut result = ParsedSearchQuery::default();
    let raw = raw.trim();
    if raw.is_empty() {
        return result;
    }

    if let Some(c) = RE_FROM.captures(raw) {
        result.from_address = Some(c.get(1).unwrap().as_str().to_string());
    }
    if let Some(c) = RE_TO.captures(raw) {
        result.to_address = Some(c.get(1).unwrap().as_str().to_string());
    }
    if let Some(c) = RE_SUBJ_QUOTED.captures(raw) {
        result.subject = Some(c.get(1).unwrap().as_str().to_string());
    } else if let Some(c) = RE_SUBJ_QUOTED_SINGLE.captures(raw) {
        result.subject = Some(c.get(1).unwrap().as_str().to_string());
    } else if let Some(c) = RE_SUBJ.captures(raw) {
        result.subject = Some(c.get(1).unwrap().as_str().to_string());
    }
    if let Some(c) = RE_AFTER.captures(raw) {
        if let Some(d) = try_parse_date(c.get(1).unwrap().as_str()) {
            result.after_date = Some(d);
        }
    }
    if let Some(c) = RE_BEFORE.captures(raw) {
        if let Some(d) = try_parse_date(c.get(1).unwrap().as_str()) {
            result.before_date = Some(d);
        }
    }
    if let Some(c) = RE_CATEGORY.captures(raw) {
        result.category = Some(c.get(1).unwrap().as_str().to_string());
    }

    result.from_or_to_union = result.from_address.is_some()
        && result.to_address.is_some()
        && RE_FROM_OR_TO_UNION.is_match(raw);

    let mut stripped = raw.to_string();
    for re in [
        &*RE_FROM,
        &*RE_TO,
        &*RE_SUBJ_QUOTED,
        &*RE_SUBJ_QUOTED_SINGLE,
        &*RE_SUBJ,
        &*RE_AFTER,
        &*RE_BEFORE,
        &*RE_CATEGORY,
    ] {
        stripped = re.replace_all(&stripped, "").trim().to_string();
    }

    // Detect domain pattern AFTER stripping operators (BUG-020: domain→from routing).
    // This ensures we only match standalone domains, not domains within email addresses like "me@z.com".
    // Allows queries like "apple.com spending" to automatically route to fromAddress filter.
    if result.from_address.is_none() {
        if let Some(c) = RE_DOMAIN.captures(&stripped) {
            let domain = c.get(1).unwrap().as_str().to_string();
            // Validate it's a domain (has at least one dot)
            if domain.contains('.') {
                result.from_address = Some(domain);
            }
        }
    }

    // Strip domain-like tokens from the FTS remainder (same matcher as detection). When the user
    // typed `@domain.tld`, removing `domain.tld` leaves a lone `@` — clean that up (FTS5 syntax error).
    if result.from_address.is_some() {
        stripped = RE_DOMAIN.replace_all(&stripped, "").trim().to_string();
        stripped = RE_STRAY_AT.replace_all(&stripped, " ").trim().to_string();
    }

    let mut query = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    if result.from_or_to_union {
        let re_paren_or = Regex::new(r"^\(\s*OR\s*\)\s+").unwrap();
        query = re_paren_or.replace(&query, "").trim().to_string();
    }
    query = strip_outer_paren_group_if_redundant(&query);
    let re_only = Regex::new(r"^(OR|AND)(\s+(OR|AND))*$").unwrap();
    let filters_n = [
        result.from_address.as_ref(),
        result.to_address.as_ref(),
        result.subject.as_ref(),
        result.after_date.as_ref(),
        result.before_date.as_ref(),
        result.category.as_ref(),
    ]
    .iter()
    .filter(|o| o.is_some())
    .count();
    let tq = query.trim();
    if re_only.is_match(tq) && filters_n > 1 {
        if !result.from_or_to_union {
            result.filter_or = Some(tq.to_uppercase().starts_with("OR"));
        }
        query.clear();
    } else if re_only.is_match(tq) {
        query.clear();
    } else {
        let re_trim = Regex::new(r"(?i)^\s*(OR|AND)\s+|\s+(OR|AND)\s*$").unwrap();
        query = re_trim.replace_all(&query, "").trim().to_string();
    }
    query = query.replace(" or ", " OR ").replace(" and ", " AND ");
    result.query = query;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input() {
        let r = parse_search_query("");
        assert_eq!(r.query, "");
        assert!(r.from_address.is_none());
    }

    #[test]
    fn from_only() {
        let r = parse_search_query("from:alice@example.com");
        assert_eq!(r.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn from_with_remainder() {
        let r = parse_search_query("from:alice@example.com invoice");
        assert_eq!(r.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(r.query, "invoice");
    }

    #[test]
    fn to_operator() {
        let r = parse_search_query("to:bob@example.com");
        assert_eq!(r.to_address.as_deref(), Some("bob@example.com"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn subject_operator() {
        let r = parse_search_query("subject:meeting");
        assert_eq!(r.subject.as_deref(), Some("meeting"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn subject_quoted_double() {
        let r = parse_search_query(r#"from:a@b.com subject:"VIP dinner""#);
        assert_eq!(r.from_address.as_deref(), Some("a@b.com"));
        assert_eq!(r.subject.as_deref(), Some("VIP dinner"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn subject_quoted_single() {
        let r = parse_search_query(r#"subject:'year-end review'"#);
        assert_eq!(r.subject.as_deref(), Some("year-end review"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn after_iso() {
        let r = parse_search_query("after:2024-01-01");
        assert_eq!(r.after_date.as_deref(), Some("2024-01-01"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn after_relative_yyyy_mm_dd() {
        let r = parse_search_query("after:7d");
        assert!(r.after_date.is_some());
        let d = r.after_date.unwrap();
        assert!(regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$")
            .unwrap()
            .is_match(&d));
    }

    #[test]
    fn before_iso() {
        let r = parse_search_query("before:2024-12-31");
        assert_eq!(r.before_date.as_deref(), Some("2024-12-31"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn multiple_operators() {
        let r = parse_search_query("from:alice@example.com subject:invoice after:7d");
        assert_eq!(r.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(r.subject.as_deref(), Some("invoice"));
        assert!(r.after_date.is_some());
        assert_eq!(r.query, "");
    }

    #[test]
    fn remainder_with_or() {
        let r = parse_search_query("from:alice@example.com invoice OR receipt");
        assert_eq!(r.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(r.query, "invoice OR receipt");
    }

    #[test]
    fn normalizes_or_and() {
        let r = parse_search_query("invoice or receipt");
        assert_eq!(r.query, "invoice OR receipt");
        let r2 = parse_search_query("invoice and receipt");
        assert_eq!(r2.query, "invoice AND receipt");
    }

    #[test]
    fn operator_in_middle() {
        let r = parse_search_query("invoice from:alice@example.com receipt");
        assert_eq!(r.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(r.query, "invoice receipt");
    }

    #[test]
    fn ignores_invalid_after_date() {
        let r = parse_search_query("after:invalid-date");
        assert!(r.after_date.is_none());
    }

    #[test]
    fn complex_all_operators() {
        let r = parse_search_query(
            "from:alice@example.com to:bob@example.com subject:meeting after:7d before:2024-12-31 invoice OR receipt",
        );
        assert_eq!(r.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(r.to_address.as_deref(), Some("bob@example.com"));
        assert_eq!(r.subject.as_deref(), Some("meeting"));
        assert!(r.after_date.is_some());
        assert_eq!(r.before_date.as_deref(), Some("2024-12-31"));
        assert_eq!(r.query, "invoice OR receipt");
    }

    #[test]
    fn text_only() {
        let r = parse_search_query("invoice receipt");
        assert_eq!(r.query, "invoice receipt");
        assert!(r.from_address.is_none());
    }

    #[test]
    fn at_domain_routes_to_from_and_clears_fts_remainder() {
        let r = parse_search_query("@greenlonghorninc.com");
        assert_eq!(r.from_address.as_deref(), Some("greenlonghorninc.com"));
        assert_eq!(r.query, "");
    }

    #[test]
    fn whitespace_trimmed() {
        let r = parse_search_query("  from:alice@example.com  invoice  ");
        assert_eq!(r.from_address.as_deref(), Some("alice@example.com"));
        assert_eq!(r.query, "invoice");
    }

    #[test]
    fn filter_only_or_between_filters() {
        let r = parse_search_query("from:marcio OR to:marcio");
        assert_eq!(r.from_address.as_deref(), Some("marcio"));
        assert_eq!(r.to_address.as_deref(), Some("marcio"));
        assert_eq!(r.query, "");
        assert!(r.from_or_to_union);
        assert_eq!(r.filter_or, None);
    }

    #[test]
    fn filter_only_and_between_filters() {
        let r = parse_search_query("from:alice AND to:bob");
        assert_eq!(r.from_address.as_deref(), Some("alice"));
        assert_eq!(r.to_address.as_deref(), Some("bob"));
        assert_eq!(r.query, "");
        assert_eq!(r.filter_or, Some(false));
    }

    #[test]
    fn or_with_text_terms_keeps_query() {
        let r = parse_search_query("from:alice invoice OR receipt");
        assert_eq!(r.from_address.as_deref(), Some("alice"));
        assert_eq!(r.query, "invoice OR receipt");
    }

    #[test]
    fn parenthesized_from_or_to_with_fts() {
        let r = parse_search_query(
            r#"(from:dad@sbcglobal.net OR to:dad@sbcglobal.net) (golf OR "tee time")"#,
        );
        assert_eq!(r.from_address.as_deref(), Some("dad@sbcglobal.net"));
        assert_eq!(r.to_address.as_deref(), Some("dad@sbcglobal.net"));
        assert!(r.from_or_to_union);
        assert_eq!(r.query, r#"golf OR "tee time""#);
    }

    #[test]
    fn from_or_to_union_unparens_with_keyword() {
        let r = parse_search_query("from:a@x.com OR to:b@y.com meeting");
        assert!(r.from_or_to_union);
        assert_eq!(r.query, "meeting");
    }

    #[test]
    fn validate_rejects_gmail_style_attachment_operator() {
        let e = validate_search_query_operators("attachment:pdf").unwrap_err();
        assert!(e.contains("attachment"), "{e}");
    }

    #[test]
    fn validate_rejects_has_operator() {
        let e = validate_search_query_operators("has:attachment").unwrap_err();
        assert!(e.contains("has"), "{e}");
    }

    #[test]
    fn validate_rejects_inline_operators() {
        let e = validate_search_query_operators("from:a@b.com subject:meet after:7d").unwrap_err();
        assert!(e.contains("from:"), "{e}");
    }

    #[test]
    fn validate_ignores_http_urls() {
        validate_search_query_operators("see https://example.com/foo for details").unwrap();
    }

    #[test]
    fn normalize_search_date_spec_iso_and_rolling() {
        assert_eq!(
            normalize_search_date_spec("2024-06-01").unwrap(),
            "2024-06-01"
        );
        let d = normalize_search_date_spec("7d").unwrap();
        assert!(regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$")
            .unwrap()
            .is_match(&d));
    }

    #[test]
    fn normalize_search_date_spec_rejects_empty() {
        assert!(normalize_search_date_spec("").is_err());
    }
}
