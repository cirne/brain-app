# BUG-054: `--body` flag text leaks into sent email body — Agent-Reported

**Status:** Fixed (2026-04-12). **Created:** 2026-04-12. **Tags:** draft, send, cli, agent-first

**Design lens:** [Agent-first](../../VISION.md) — Outbound mail must match user intent. CLI flags are transport for the tool, not content for recipients.

**Reported context:** Delivered email observed in a forwarded thread. Evidence from `riptest/feedback/submitted/bug-body-flag-leaks-into-sent-email.md`.

---

## Resolution (2026-04-12)

- **`strip_leading_cli_body_flag`** in [`src/send/draft_body.rs`](../../../src/send/draft_body.rs) removes a leading accidental `--body` / `--body=` prefix (only at a clear flag boundary; does not strip `--bodyfoo`). Applied at the start of **`draft_markdown_to_plain_text`** so `ripmail send <draft-id>` fixes older drafts on disk without editing files.
- **`write_draft`** in [`src/send/draft_store.rs`](../../../src/send/draft_store.rs) runs the same sanitizer before writing YAML frontmatter so `draft view` / JSON and new files never persist the leak.
- **`draft edit` / `draft rewrite`:** [`drop_leading_trailing_body_flag_tokens`](../../../src/draft.rs) drops mistaken leading `--body` tokens from trailing argv (`draft edit` and `draft rewrite` have no `--body` option; after `--`, `--body` is a literal token). See parser test `draft_edit_parses_double_hyphen_with_body_token` in [`src/cli/args.rs`](../../../src/cli/args.rs).

**Tests:** `draft_body` unit tests; `write_draft_strips_leading_cli_body_flag` in `draft_store`; `trailing_body_flag_tests` in `draft.rs`.

---

## Summary

An outgoing message composed with the `--body` flag arrived with the literal prefix `--body ` at the start of the plain-text body (before the intended first words). Recipients and reply quotes show the malformed text. The flag name must never appear in stored draft content or in the SMTP body.

---

## What the agent did (and what happened)

A message was composed using `ripmail draft` with `--body` to supply text, then sent with `ripmail send <draft-id>`. The delivered body began with `--body` followed by the real message (e.g. `--body Brian, thank you so much…` instead of starting at `Brian, thank you so much…`).

---

## Root causes

**Hypothesis (from reporter):** The value passed into the draft pipeline may include the token `--body` (e.g. mistaken positional capture, shell/agent quoting that embeds the flag in the value, or draft serialization that concatenates argv fragments). Alternatively, body extraction may not strip a leading `--body` when present.

**Actual:** `draft edit` / `draft rewrite` trailing args can include the literal token `--body` when agents mirror `draft new`/`reply` style; joined text or LLM output surfaced it at the start of the body. Separately, any string that already had a leading `--body ` prefix persisted until send.

---

## Recommendations (concise)

Addressed by the Resolution above. Related outbound normalization: [BUG-041](BUG-041-sent-mail-literal-backslash-n-in-body.md) (literal `\n` in sent body).

---

## References

- Vision (agent-first): [VISION.md](../../VISION.md)
- Related: [BUG-041](BUG-041-sent-mail-literal-backslash-n-in-body.md)
- Source feedback: `../../../riptest/feedback/submitted/bug-body-flag-leaks-into-sent-email.md` (from `docs/bugs/archive/`)
