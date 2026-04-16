# BUG-042: Search — FTS5 syntax errors leak for `&` and other reserved characters

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** search, fts5, errors, cli, agent-first

**Design lens:** [Agent-first](../../VISION.md) — user- or agent-supplied queries must not surface raw SQLite/FTS5 failures; either escape/sanitize or return a clear, recoverable error.

---

## Summary

Queries containing FTS5-reserved characters (e.g. `&`, `"`, `(`, `)`, `*`, `^`, `+`, `-` in some contexts) can produce a raw SQLite failure instead of helpful guidance or safe handling.

**Example:**

```bash
ripmail search "Q&A OR C++"
```

**Observed:**

```text
Error: SqliteFailure(Error { code: Unknown, extended_code: 1 }, Some("fts5: syntax error near \"&\""))
```

**Expected:** Sanitized/escaped FTS query, or a user-facing message such as: unsupported characters in query; try quoting, removing operators, or simplifying the phrase.

---

## Reported context

- **Session:** ztest / agent UAT, 2026-04-11  
- **ripmail:** 0.1.6  
- **Repro:** Reliable with `&` in query; likely similar for other FTS5 specials  

---

## Root causes

FTS5 query construction passes user text through to the virtual table without normalizing characters that FTS treats as operators. Agents cannot predict which literals are safe.

---

## Recommendations

1. Escape or token-wrap user phrases for FTS5, or reject early with a stable, documented error code and hint text.  
2. Document (CLI help / skill) which characters need quoting or avoidance if full escaping is deferred.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- Feedback: `riptest/feedback/bug-search-special-chars-fts5-crash.md` (processed 2026-04-11)
