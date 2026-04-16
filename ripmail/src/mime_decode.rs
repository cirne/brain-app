//! RFC 2047 / display decoding for header values stored or shown in the CLI.

use mail_parser::MessageParser;

/// Decode MIME encoded-words in a Subject (or similar) line for display and JSON.
/// Pass-through when no `=?` encoded segments are present.
pub fn decode_rfc2047_header_line(value: &str) -> String {
    let t = value.trim();
    if t.is_empty() || !t.contains("=?") {
        return value.to_string();
    }
    // Minimal message so mail-parser applies the same RFC 2047 path as normal parse.
    let header: String = t
        .chars()
        .map(|c| match c {
            '\r' | '\n' => ' ',
            c => c,
        })
        .collect();
    let fake = format!("Subject: {header}\r\n\r\n");
    match MessageParser::default().parse(fake.as_bytes()) {
        Some(msg) => msg
            .subject()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| value.to_string()),
        None => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_q_subject() {
        let raw = "=?UTF-8?Q?Re=3A_Hello_=E2=80=93_world?= ";
        let out = decode_rfc2047_header_line(raw);
        assert!(out.contains("Re:") || out.contains("Hello"));
        assert!(!out.starts_with("=?"));
    }

    #[test]
    fn plain_unchanged() {
        assert_eq!(decode_rfc2047_header_line("Invoice due"), "Invoice due");
    }
}
