//! Markdown draft body → plain text / HTML for SMTP (mirrors `draft-body-plain.ts`).

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
        use pulldown_cmark::{Event, TagEnd};
        match event {
            Event::Text(t) | Event::Code(t) => out.push_str(&t),
            Event::SoftBreak | Event::HardBreak => out.push('\n'),
            // Block boundaries do not emit Text/SoftBreak; without this, consecutive paragraphs glue.
            Event::End(TagEnd::Paragraph) | Event::End(TagEnd::Heading(..)) => out.push_str("\n\n"),
            _ => {}
        }
    }
    let re = Regex::new(r"\n{3,}").expect("regex");
    re.replace_all(&out, "\n\n").trim().to_string()
}

/// HTML-escape a string for safe insertion in HTML text nodes.
fn html_escape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

/// Wrap a **normalized** plain body (e.g. after `normalize_smtp_plain_body`) in minimal valid HTML
/// when the send path has no draft markdown (CLI `--body` only: same bytes as the plain part,
/// with paragraphs and line breaks preserved).
pub fn plain_to_minimal_html(plain: &str) -> String {
    let t = plain.replace("\r\n", "\n");
    let t = t.trim_end_matches(['\r', '\n']);
    if t.is_empty() {
        return r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
</head>
<body></body>
</html>"#
            .to_string();
    }
    let parts: Vec<&str> = t
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    let inner: String = parts
        .iter()
        .map(|p| {
            let lines: Vec<&str> = p.split('\n').collect();
            let escaped: Vec<String> = lines.iter().map(|line| html_escape_text(line)).collect();
            format!("<p>{}</p>", escaped.join("<br>\n"))
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
</head>
<body>
{inner}
</body>
</html>
"#
    )
}

/// Convert draft body (Markdown) to HTML for `text/html` in `multipart/alternative`.
///
/// Uses the same [`strip_leading_cli_body_flag`] and [`pulldown_cmark`] options as
/// [`draft_markdown_to_plain_text`], via `pulldown_cmark::html::push_html`.
pub fn draft_markdown_to_html(body: &str) -> String {
    let normalized = strip_leading_cli_body_flag(body).replace("\r\n", "\n");
    let mut body_html = String::new();
    let parser = pulldown_cmark::Parser::new_ext(
        &normalized,
        pulldown_cmark::Options::ENABLE_TABLES | pulldown_cmark::Options::ENABLE_STRIKETHROUGH,
    );
    pulldown_cmark::html::push_html(&mut body_html, parser);
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
</head>
<body>
{body_html}
</body>
</html>
"#
    )
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
    fn paragraph_breaks_emit_blank_lines() {
        let s = draft_markdown_to_plain_text(
            "Hi Donna,\n\nYou can review the draft below:\n\nhttps://example.com/",
        );
        assert!(
            s.contains("Hi Donna,\n\nYou can review"),
            "paragraph gap missing; got {:?}",
            s
        );
        assert!(
            s.contains("below:\n\nhttps://"),
            "second paragraph gap missing; got {:?}",
            s
        );
        assert!(
            !s.contains("Donna,You"),
            "paragraphs must not concatenate; got {:?}",
            s
        );
    }

    #[test]
    fn heading_followed_by_paragraph_has_separator() {
        let s = draft_markdown_to_plain_text("## Title\n\nBody line.");
        assert!(s.contains("Title"), "got {:?}", s);
        assert!(s.contains("Body line."), "got {:?}", s);
        assert!(
            s.contains("Title\n\nBody"),
            "heading/body gap missing; got {:?}",
            s
        );
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

    #[test]
    fn draft_markdown_to_html_emits_links_and_semantic_tags() {
        let h = draft_markdown_to_html("See [docs](https://example.com) and **bold**.");
        assert!(h.contains("https://example.com"));
        assert!(h.contains("<a href=\"https://example.com"));
        assert!(h.contains("<strong>bold</strong>") || h.contains("<strong>"));
    }

    #[test]
    fn draft_markdown_to_html_strips_leading_body_flag() {
        let h = draft_markdown_to_html("--body Hello [x](https://a.test)");
        assert!(!h.contains("--body"));
        assert!(h.contains("https://a.test"));
    }

    #[test]
    fn plain_to_minimal_html_escapes_and_paragraphs() {
        let h = plain_to_minimal_html("Line1\n\nLine2 & <3");
        assert!(h.contains("<p>Line1</p>"));
        assert!(h.contains("<p>Line2 &amp; &lt;3</p>"));
    }

    #[test]
    fn plain_to_minimal_html_line_breaks_inside_paragraph() {
        let h = plain_to_minimal_html("A\nB");
        assert!(h.contains("A"));
        assert!(h.contains("B"));
        assert!(h.contains("<br>"));
    }
}
