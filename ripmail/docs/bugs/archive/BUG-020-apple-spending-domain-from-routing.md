# BUG-020: Apple / Vendor Spending Query — Domain Not Routed to fromAddress

**Status:** **Fixed (2026-04-10).** **Created:** 2026-03-10. **Tags:** ask, eval, search

**Design lens:** [Agent-first](../../VISION.md) — For "summarize my spending on apple.com" (and similar vendor/domain spending queries), the system should return all transactional emails from that sender.

**Supersedes:** The remaining slice from [BUG-016](BUG-016-bakeoff-incomplete-coverage-critical.md) (archived) after other items were addressed (instructions, tool docs, noise-excluded-by-default).

---

## Summary

For questions like "summarize my spending on apple.com in the last 30 days":

- **Intended behavior:** Treat `apple.com` as a sender/domain filter and return matching messages (exhaustive `from_address` filter path).
- **Was wrong:** The agent often put the domain in the **query** string instead of **fromAddress**, so search ran FTS on a phrase like `"apple.com"` instead of a filter.

**Fix shipped:** `parse_search_query()` detects a domain-like token (after operator stripping), sets `from_address`, and strips it from the FTS remainder — e.g. `apple.com spending` → from filter + query `spending`. See `ripmail/src/search/query_parse.rs` and tests in `ripmail/tests/search_fts.rs` (`domain_detection_*`, `apple.com spending` cases).

---

## Root cause (historical)

1. **Agent uses query instead of fromAddress:** Nano sometimes put `"apple.com"` in the search **query** instead of **fromAddress**.
2. **No backend fallback:** Search did not rewrite domain-like tokens to a `from:` filter.

---

## References

- Implementation: `src/search/query_parse.rs` (BUG-020 comments).
- Tests: `tests/search_fts.rs` — domain routing / `apple.com spending`.
- Original broad bug (archived): [BUG-016](BUG-016-bakeoff-incomplete-coverage-critical.md).
