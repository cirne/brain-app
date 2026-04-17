//! Phonetic name match (double metaphone via `rphonetic`).

use rphonetic::{DoubleMetaphone, Encoder};
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Prepare strings for [`DoubleMetaphone::encode`]. `rphonetic` indexes by byte and can panic on
/// UTF-8 punctuation (e.g. U+2019 in `DICK'S` vs ASCII `'`).
fn normalize_for_double_metaphone(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.nfd() {
        if is_combining_mark(c) {
            continue;
        }
        let c = match c {
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => '\'',
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => '"',
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2015}' => '-',
            '\u{00A0}' => ' ',
            c => c,
        };
        if c.is_ascii() {
            out.push(c);
        } else if c.is_alphabetic() {
            // Non-Latin scripts: avoid passing multibyte text into rphonetic.
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn primary_code(s: &str) -> String {
    let normalized = normalize_for_double_metaphone(s);
    DoubleMetaphone::default().encode(&normalized)
}

/// True if tokens share the same double-metaphone primary (e.g. Jon / John).
pub fn name_matches_phonetically(name_token: &str, query: &str) -> bool {
    let n = name_token.trim();
    let q = query.trim();
    if n.is_empty() || q.is_empty() {
        return false;
    }
    let pn = primary_code(n);
    let pq = primary_code(q);
    !pn.is_empty() && pn == pq
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jon_john_match() {
        assert!(name_matches_phonetically("Jon", "John"));
    }

    #[test]
    fn unrelated_no_match() {
        assert!(!name_matches_phonetically("Lewis", "Donna"));
    }

    #[test]
    fn empty_tokens() {
        assert!(!name_matches_phonetically("", "John"));
        assert!(!name_matches_phonetically("John", ""));
    }

    #[test]
    fn unicode_apostrophe_does_not_panic() {
        let _ = name_matches_phonetically("DICK\u{2019}S Sporting", "dick");
    }
}
