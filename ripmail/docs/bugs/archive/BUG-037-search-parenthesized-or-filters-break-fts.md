# BUG-037: Parenthesized OR across `from:`/`to:` filters breaks FTS term matching

**Status:** Fixed (2026-04-05). **Created:** 2026-04-05. **Tags:** search, rules, fts, agent-first

**Design lens:** [Agent-first](../../VISION.md) — agents naturally compose compound queries like `(from:a OR to:a) golf` to express "any direction involving person X about topic Y" in a single rule. When this silently returns zero results, agents cannot diagnose the failure without trial-and-error decomposition.

---

## Summary

- **Observed:** `ripmail search '(from:daderr@sbcglobal.net OR to:daderr@sbcglobal.net) (golf OR "tee time")'` returned **zero** results.
- **Expected:** Union of messages from/to that address containing "golf" or "tee time."
- **Impact:** `ripmail rules add --query '(from:… OR to:…) term'` silently created rules that never matched.

---

## Root cause (resolved)

1. **SQL:** Both `from:` and `to:` were extracted, but without OR semantics the planner required **both** address predicates (impossible for normal mail), so FTS never surfaced rows.
2. **Parsing:** `to:` used `\S+`, which consumed the closing `)` of `(from:… OR to:…)`, corrupting the FTS remainder.
3. **FTS:** A redundant outer `( … )` around the keyword clause led to FTS5 `MATCH` strings that matched nothing.

---

## Resolution (2026-04-05)

- Detect `from:x OR to:y` / `to:x OR from:y` (optional leading `(`) and set **`from_or_to_union`** so SQL uses `(from match OR to match) AND MATCH …` instead of ANDing both filters.
- Parse `from:` / `to:` values with **`[^)\s]+`** so group-closing `)` is not swallowed.
- Strip the leftover `( OR )` artifact after removing filter tokens, strip one balanced outer `()` around the FTS remainder when safe, and skip legacy **`filter_or`** for the empty-remainder case when `from_or_to_union` already applies.
- Tests: `src/search/query_parse.rs`, `tests/search_fts.rs` (`fts_from_or_to_union_parenthesized_with_keyword`).

---

## References

- Related: [BUG-032](../BUG-032-search-query-should-be-optional-with-filters.md) — other search query ergonomics gap.
