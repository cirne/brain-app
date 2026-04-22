# BUG-060: `search` / `search_index` miss receipt and order text that only appears in HTML

**Status: Fixed (2026-04-22).** **Tags:** search, index, mime, receipts

## Summary

**Symptom:** `ripmail search` and brain-app `search_index` (regex on `messages.body_text` + subject) returned messages for broad sender/subject queries but **not** for exact phrases that are clearly visible in the mail client, such as “thank you for your purchase”, merchant display names, or order ids like `#MB12869`, when that text existed only in the **HTML** part of `multipart/alternative` mail.

**Root cause:** MIME parsing for indexing used `text/plain` whenever present (`mail_parser::Message::body_text(0)`), and **did not** fall back to `text/html` when the plain part was empty, whitespace-only, or a **short stub** while the user-visible copy (and order tables) lived in HTML. The forward/excerpt path already had an empty-plain → HTML fallback; the index path did not.

**Fix:** `ripmail/src/sync/parse_message.rs` — central `indexable_bodies()`:

- If `text/plain` is **empty/whitespace**, index HTML → markdown (same as before for HTML-only messages).
- If plain is a **short stub** (`trim` length &lt; 200) and `text/html` is **large** (len ≥ 400 and &gt; 6× plain length), **prefer** HTML-derived text so receipt/marketing messages match what users see.

Shared by `parse_raw_message` / `parse_index_message` and `parse_read_full` for consistency.

**Tests:** `indexable_body_tests` in `parse_message.rs`; `search_receipt_phrase_and_hashed_order_id` in `tests/search_fts.rs`.

## Caveats

- **Already-synced** messages keep the old `body_text` until the corresponding `.eml` is **re-parsed** (e.g. `ripmail sync` / rebuild paths that re-run `parse_raw_message` and persist). No automatic backfill in this change.
- **`pattern` is still a Rust regular expression** (not Gmail query syntax). JSON-escaped `\"` in tool params become **literal** quote characters in the regex; to match a phrase, use a substring or alternation (e.g. `Shopify|MB12869`) without expecting Gmail-style `""` phrase semantics.
- **Attachments** are not part of `body_text`; PDF-only receipts remain out of scope (see OPP-006 in docs).

## References

- [ARCHITECTURE.md](../../ARCHITECTURE.md) — `body_text` and search
- [BUG-049](BUG-049-search-from-operator-plus-keywords-returns-empty.md) (archived) — filter + keyword intersection
