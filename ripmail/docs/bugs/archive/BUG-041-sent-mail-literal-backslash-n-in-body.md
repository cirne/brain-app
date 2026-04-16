# BUG-041: Sent mail body shows literal `\n` instead of line breaks

**Status:** Fixed (2026-04-08). **Created:** 2026-04-07. **Tags:** send, draft, smtp, llm, agent-first

**Design lens:** [Agent-first](../../VISION.md) — recipients should see normal paragraph breaks. Literal two-character `\n` in `text/plain` looked like a ripmail/SMTP encoding failure but was usually upstream of SMTP.

---

## Resolution (2026-04-08)

- **`normalize_smtp_plain_body`** in [`src/send/smtp_send.rs`](../../../src/send/smtp_send.rs) runs on the plain text before MIME build: interprets JSON/shell-style escapes `\n`, `\r`, `\t`, and `\\` so common literal two-character sequences become real newlines. Trailing `\` and unknown escapes after `\` are preserved.
- Unit tests in the same module cover typical and edge cases (including `\\n` remaining visible when double-escaped in source).

## Follow-on: quoted-printable must not undo real newlines (2026-04-10)

An attempt to fix paragraph breaks by manipulating newlines **without** fixing QP soft-wrap could surface a different failure: recipients saw `CLI.A second` with no blank line because **`=\r\n` soft breaks** merged lines across a sentence boundary. That is **orthogonal** to BUG-041: normalization turns literal `\n` into U+000A first; the MIME layer must then preserve those boundaries when using quoted-printable.

**Regression coverage (do not drop when touching send/MIME):**

- `send::smtp_send::tests::formatted_plain_body_preserves_paragraph_newlines_after_qp` — long body, QP on the wire, no `CLI=\r\n.A`, round-trip decode matches normalized plain text.
- `send::smtp_send::tests::formatted_body_round_trips_literal_backslash_n_then_qp` — literal two-char `\n\n` in input (BUG-041 shape) becomes real newlines, then survives lettre + `mail_parser` decode.
- `tests/smtp_qp_paragraph_merge_fixture.rs` + `tests/fixtures/smtp_qp_soft_break_merges_paragraph.eml` — documents bad QP folding from the wild (decoded merge).

---

## Summary (historical)

- **Observed:** Outbound mail (often from a draft `.md` file) arrived with visible `\n` sequences in the body instead of rendered newlines.
- **Expected:** Paragraph breaks appear as normal line breaks in the mail client.
- **Impact:** Unprofessional outbound copy; agents may wrongly blame SMTP or MIME encoding.

---

## Example (symptom)

Body as seen by recipient (single line or with visible escape sequences):

```text
Hi Sterling,\n\nLet's move the return flight ...
```

---

## Root cause (historical)

SMTP and lettre were behaving correctly: they sent the Rust `String` as `text/plain` with real newline bytes where the string contained U+000A. The defect was that the **draft body string** sometimes contained the **two characters** backslash (U+005C) and `n` (U+006E), not newline characters.

Relevant pipeline:

1. `send_draft_by_id` (`src/send/mod.rs`) calls `draft_markdown_to_plain_text` on `draft.body`, then `send_simple_message` (`src/send/smtp_send.rs`) with that text.
2. `draft_markdown_to_plain_text` (`src/send/draft_body.rs`) runs the body through pulldown_cmark. It does **not** interpret the substring `\` + `n` as a newline in all cases. LLM JSON double-escape, shell `--body` quoting, or pasted JSON could persist literal `\n` into the draft.
3. Pre-send normalization in SMTP now addresses the common outbound case without changing markdown semantics for storage.

---

## Related code

- `src/send/smtp_send.rs` — `normalize_smtp_plain_body`, `send_simple_message`
- `src/send/draft_body.rs` — `draft_markdown_to_plain_text`
- `src/send/mod.rs` — `send_draft_by_id`
