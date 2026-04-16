# BUG-049: Combining `from:` with keyword terms returns zero results (silent)

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** search, fts, filters, agent-first

**Design lens:** [Agent-first](../../VISION.md) — `from:` plus free-text keywords must intersect correctly; silent empty results force multi-call workarounds (`who` + broad search).

---

## Summary

**Reported (historical zmail CLI; verify on Rust ripmail):**

```bash
ripmail search "from:rudy"              # matches sender
ripmail search "golf cart"              # matches content
ripmail search "golf cart from:rudy"    # 0 results
ripmail search "from:rudy golf cart"    # 0 results
```

**Expected:** Intersection of address filter and FTS (or equivalent) on body/subject.

**Impact:** Agents answering “what did Rudy say about the golf cart?” need extra calls (`who`, thread, broader searches). Documented in bakeoffs #006–#009 as a major round-trip multiplier.

**Note:** [BUG-037 archived](archive/BUG-037-search-parenthesized-or-filters-break-fts.md) fixed parenthesized **OR** across `from`/`to`; this report is **AND** of `from:` with keyword terms.

---

## Reported context

- Feedback: `riptest/feedback/bug-from-operator-plus-keywords-returns-empty.md`  
- Related proposal: `riptest/feedback/feature-rich-search-output.md` (fuzzy `from:` + combined queries)  
- **Session:** processed 2026-04-11  

---

## Recommendations

1. Reproduce on current `ripmail` Rust search SQL; add integration tests for `from:x` + keyword.  
2. Ensure parser builds one conjunctive query path (address filter ∩ FTS), not two incompatible stages.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- [BUG-037 archived — OR + FTS](archive/BUG-037-search-parenthesized-or-filters-break-fts.md)  
- Feedback: `riptest/feedback/bug-from-operator-plus-keywords-returns-empty.md`
