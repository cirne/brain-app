//! Markdown draft body → plain text for SMTP (mirrors `draft-body-plain.ts`).

use regex::Regex;

/// Remove a leading accidental `--body` CLI token from the start of draft text (BUG-054).
///
/// Only strips when `--body` is clearly the flag: `--body=…`, `--body` at end with nothing after,
/// or `--body` followed by Unicode whitespace. Does not strip `--bodyfoo` (not a flag boundary).
/// Repeated leading `--body` tokens are removed after each trim.
pub fn strip_leading_cli_body_flag(s: &str) -> String {
    let mut s = s;
    loop {
        let t = s.trim_start();
        if let Some(rest) = t.strip_prefix("--body=") {
            return rest.to_string();
        }
        if !t.starts_with("--body") {
            return t.to_string();
        }
        let after = &t["--body".len()..];
        if after.is_empty() {
            return String::new();
        }
        if !after.starts_with(char::is_whitespace) {
            return t.to_string();
        }
        s = after.trim_start();
    }
}

/// Convert draft body (often Markdown) to plain text for `text/plain`.
pub fn draft_markdown_to_plain_text(body: &str) -> String {
    let normalized = strip_leading_cli_body_flag(body).replace("\r\n", "\n");
    let mut out = String::new();
    for event in pulldown_cmark::Parser::new_ext(
        &normalized,
        pulldown_cmark::Options::ENABLE_TABLES | pulldown_cmark::Options::ENABLE_STRIKETHROUGH,
    ) {
        use pulldown_cmark::Event;
        match event {
            Event::Text(t) | Event::Code(t) => out.push_str(&t),
            Event::SoftBreak | Event::HardBreak => out.push('\n'),
            _ => {}
        }
    }
    let re = Regex::new(r"\n{3,}").expect("regex");
    re.replace_all(&out, "\n\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_bold_and_collapses_blank_lines() {
        let s = draft_markdown_to_plain_text("Hello **world**\n\n\n\nMore.");
        assert!(s.contains("Hello"));
        assert!(s.contains("world"));
        assert!(!s.contains("**"));
    }

    #[test]
    fn strip_leading_cli_body_flag_unchanged() {
        assert_eq!(strip_leading_cli_body_flag("Hello"), "Hello");
        assert_eq!(
            strip_leading_cli_body_flag("Line one\n--body not at start"),
            "Line one\n--body not at start"
        );
    }

    #[test]
    fn strip_leading_cli_body_flag_prefix() {
        assert_eq!(strip_leading_cli_body_flag("--body hello"), "hello");
        assert_eq!(strip_leading_cli_body_flag("  \t--body\thello"), "hello");
        assert_eq!(strip_leading_cli_body_flag("--body"), "");
        assert_eq!(strip_leading_cli_body_flag("--body=foo"), "foo");
        assert_eq!(strip_leading_cli_body_flag("--body=foo bar"), "foo bar");
    }

    #[test]
    fn strip_leading_cli_body_flag_no_boundary() {
        assert_eq!(strip_leading_cli_body_flag("--bodyfoo"), "--bodyfoo");
    }

    #[test]
    fn strip_leading_cli_body_flag_repeated() {
        assert_eq!(strip_leading_cli_body_flag("--body --body hello"), "hello");
    }

    #[test]
    fn draft_markdown_strips_body_flag_before_markdown() {
        let s = draft_markdown_to_plain_text("--body Hello **x**");
        assert!(!s.starts_with("--body"));
        assert!(s.contains("Hello"));
        assert!(s.contains("x"));
        assert!(!s.contains("**"));
    }
}
