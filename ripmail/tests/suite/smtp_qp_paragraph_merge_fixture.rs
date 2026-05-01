//! Regression: quoted-printable soft line breaks can merge `CLI` + `.A` across a physical line
//! boundary, so decoders (and `ripmail read`) see `CLI.A second…` with no paragraph gap.
//!
//! Fixture body matches an outbound message captured in the wild after `ripmail send` (lettre /
//! `quoted_printable` line wrapping). See `tests/fixtures/smtp_qp_soft_break_merges_paragraph.eml`.

use mail_parser::MessageParser;
use std::fs;
use std::path::PathBuf;

#[test]
fn fixture_qp_soft_break_merges_cli_dot_a_and_drops_blank_line_before_second_paragraph() {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/smtp_qp_soft_break_merges_paragraph.eml");
    let raw = fs::read(&p).expect("read fixture");
    let msg = MessageParser::default()
        .parse(&raw)
        .expect("parse fixture .eml");
    let body = msg.body_text(0).expect("text/plain body").into_owned();

    assert!(
        body.contains("CLI.A second"),
        "expected merged `CLI` + `.A` after QP decode (paragraph boundary lost); body: {body:?}"
    );
    assert!(
        !body.contains("CLI.\n\nA second"),
        "decoded body must not contain a blank line between first and second paragraph; body: {body:?}"
    );
}
