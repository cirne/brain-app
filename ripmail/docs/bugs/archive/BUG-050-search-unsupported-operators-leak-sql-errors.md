# BUG-050: Unsupported search “operators” (e.g. `attachment:`) leak raw SQL errors

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** search, sql, errors, agent-first

**Design lens:** [Agent-first](../../VISION.md) — unknown query syntax should be validated before SQL generation with a message listing supported operators; never expose `no such column` from SQLite.

---

## Summary

**Reported (Node zmail era; verify on Rust):**

Queries resembling Gmail-style operators:

- `attachment:pdf`  
- `has:attachment`  

surfaced errors such as:

```text
no such column: attachment
no such column: has
```

**Expected:** Clear “unknown operator” (or implement dedicated attachment filters in [OPP-006 archived](../opportunities/archive/OPP-006-attachment-search-and-caching.md) / product plan).

**Overlap:** Same theme as [BUG-033](BUG-033-actionable-file-not-found-errors.md) (actionable errors) but for **search query parsing**, not filesystem.

---

## Reported context

- Original: `riptest/feedback/bug-sql-error-on-unsupported-search-operators.md`  
- **Session:** processed 2026-04-11  

---

## Recommendations

1. Parse recognized operators (`from:`, `to:`, `subject:`, `after:`, `before:`, …) explicitly; reject unknown tokens with a stable error string.  
2. Optionally add first-class attachment presence / type filters if product wants Gmail parity.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- [BUG-033 — actionable errors](BUG-033-actionable-file-not-found-errors.md)  
- Feedback: `riptest/feedback/bug-sql-error-on-unsupported-search-operators.md`
