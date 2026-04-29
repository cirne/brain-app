//! Hints for agent/small-model search callers: Rust regex semantics, OR rewriting, empty results.

use regex::Regex;

/// If the pattern looks like `literal OR literal …` from prose, rewrite to regex alternation
/// using `regex::escape` on each chunk so `.` and `@` behave as literals.
///
/// Returns `None` when we should not rewrite (single chunk, no ` OR `, or unsafe-looking chunks).
pub fn try_rewrite_prose_or_to_alternation(raw: &str) -> Option<(String, &'static str)> {
    let t = raw.trim();
    if !t.contains(" OR ") && !t.contains(" or ") && !t.contains(" Or ") {
        return None;
    }
    // Split on case-insensitive " OR "; trim segments.
    let re_split = Regex::new(r"(?i)\s+or\s+").unwrap();
    let chunks: Vec<String> = re_split
        .split(t)
        .map(|s| s.trim().trim_matches('"'))
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    if chunks.len() < 2 {
        return None;
    }
    // Skip rewrite when any chunk clearly looks intentional regex (beyond prose OR).
    for ch in &chunks {
        if chunk_too_ambiguous(ch) {
            return None;
        }
    }
    let escaped_chunks: Vec<String> = chunks.iter().map(|c| regex::escape(c)).collect();
    let pattern = escaped_chunks.join("|");
    let hint =
        "Rewrote prose `… OR …` into regex alternation (e.g. `a|b`). Prefer `|` in `pattern` explicitly next time.";
    Some((pattern, hint))
}

fn chunk_too_ambiguous(chunk: &str) -> bool {
    // Backreferences, lookahead, boundaries — user probably meant regex.
    if chunk.contains('\\') || chunk.starts_with('(') {
        return true;
    }
    for c in chunk.chars() {
        match c {
            '*' | '+' | '?' | '[' | ']' | '^' | '$' | '{' | '}' => return true,
            _ => {}
        }
    }
    // Single pipe without OR splitter — already alternation.
    if chunk.contains('|') && !chunk.ends_with('|') && !chunk.starts_with('|') {
        let bars = chunk.chars().filter(|&c| c == '|').count();
        if bars >= 1 {
            return true;
        }
    }
    false
}

/// When regex compile failed.
pub fn hints_compile_failed(compiler_message: &str) -> Vec<String> {
    vec![
        format!("Invalid regex: {compiler_message}"),
        "Ripmail patterns are Rust regex: use `|` for alternation, not the word OR; escape `.` inside addresses with `\\.`, or put addresses in `--from` / `--to`.".to_string(),
        "Try `ripmail search --help` for flags (`--from`, `--after`).".to_string(),
    ]
}

/// When regex ran but matched nothing on subject+body (and optionally files).
pub fn hints_no_regex_matches(
    original_pattern: &str,
    had_structured_filters: bool,
    applied_prose_or_rewrite: bool,
) -> Vec<String> {
    let mut h = Vec::new();
    let p = original_pattern.trim();
    if prose_or_detected(p) && !applied_prose_or_rewrite {
        h.push(
            "Your pattern contained ` OR ` as English — regex matched those letters literally. Use `|` for alternation (e.g. `foo|bar`) or use `--from` / `--subject`.".to_string(),
        );
    }
    if prose_and_detected(p) {
        h.push(
            "Your pattern contained ` AND ` as English — regex concatenation does not mean AND. Narrow with `--subject`/`--after` filters or combine terms (e.g. `(?i)billing.*invoice`).".to_string(),
        );
    }
    if looks_like_email(p) && p.contains('@') && p.contains('.') {
        h.push(
            "In regex, `.` matches any character unless escaped. Prefer `from=…`/`--from` without a pattern, or escape dots (`user\\.name@`).".to_string(),
        );
    }
    if had_structured_filters {
        h.push(
            "Structured filters narrowed the corpus; widen `--after`/drop `--source`, or shorten the regex.".to_string(),
        );
    } else if h.is_empty() {
        h.push(
            "No hits: widen the regex, check spelling, or sync mail (`ripmail refresh`) if the mailbox is new.".to_string(),
        );
    }
    h
}

/// When date filters alone removed all rows but other filters still match mail (e.g. archive mail + rolling `Nd`).
pub fn hint_filter_only_date_window_excludes_archive(total_without_dates: i64) -> String {
    format!(
        "{} message(s) match your other filters when date bounds are removed. Rolling `--after`/`--since` (e.g. `180d`) are relative to **today**, so old mail is excluded. Omit `--after`/`--before`, or use ISO dates that cover the mailbox (e.g. `1999-01-01` for Enron-style corpora).",
        total_without_dates
    )
}

/// When filter-only search (no regex pattern) returns zero rows.
pub fn hints_filter_only_no_results(had_mailbox_filter: bool) -> Vec<String> {
    vec![
        "No messages matched these filters.".to_string(),
        if had_mailbox_filter {
            "Verify `--source`/mailbox id, date window, category, and ensure mail is indexed (`ripmail status --json`, then `refresh`).".to_string()
        } else {
            "Relax `--after`/category filters or sync (`ripmail refresh`) if indexing is stale."
                .to_string()
        },
    ]
}

fn prose_or_detected(p: &str) -> bool {
    Regex::new(r"(?i)\bOR\b").unwrap().is_match(p)
}

fn prose_and_detected(p: &str) -> bool {
    Regex::new(r"(?i)\bAND\b").unwrap().is_match(p)
}

fn looks_like_email(p: &str) -> bool {
    Regex::new(r"\S+@\S+").unwrap().is_match(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_maureen_example() {
        let raw = r#"Maureen Mcvicker OR maureen.mcvicker@enron.com"#;
        let (pat, _) = try_rewrite_prose_or_to_alternation(raw).expect("rewrite");
        assert!(pat.contains("Maureen Mcvicker") || pat.contains("Maureen\\ Mcvicker")); // escaped space ok
        assert!(pat.contains("mcvicker"));
        assert!(pat.contains('|'));
    }

    #[test]
    fn does_not_rewrite_intentional_regex() {
        assert!(try_rewrite_prose_or_to_alternation(r"(dog|cat).*").is_none());
    }

    #[test]
    fn no_or_single_chunk() {
        assert!(try_rewrite_prose_or_to_alternation("invoice receipt").is_none());
    }

    #[test]
    fn hints_pick_up_english_or() {
        let h = hints_no_regex_matches("a OR b", false, false);
        assert!(h.iter().any(|x| x.contains("|")));
    }

    #[test]
    fn email_dot_hint_present() {
        let h = hints_no_regex_matches("x@enron.com mail", false, false);
        assert!(h
            .iter()
            .any(|x| x.contains("Prefer") || x.contains("escape")));
    }
}
