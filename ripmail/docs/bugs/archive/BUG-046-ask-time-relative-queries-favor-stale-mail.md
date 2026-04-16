# BUG-046: `ripmail ask` surfaces old mail for time-relative questions (“upcoming”, “recent”)

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** ask, search, ranking, agent-first

**Design lens:** [Agent-first](../../VISION.md) — natural-language questions about “upcoming” or “recent” plans must not prioritize year-old messages when newer relevant mail exists in the index.

---

## Summary

For questions like “What are my upcoming travel plans?”, the ask pipeline returned many 2025 items while 2026 notifications existed and `ripmail search` with date filters could find them.

**Hypothesis (reported):** Broad FTS retrieval plus summarization by relevance score without strong recency bias for time-relative intents.

**Evidence:** `ripmail search "NetJets" --after 2026-04-01 --text` showed current flights; `ask` did not emphasize them.

---

## Reported context

- **Index:** ~26k messages; latest mail ~2026-04-09  
- **Today (session):** 2026-04-11  
- **ripmail:** 0.1.6  
- **Session:** ztest / agent UAT, 2026-04-11  

---

## Recommendations

1. When the user question contains time-relative cues (`upcoming`, `recent`, `latest`, `new`, `this week`), bias retrieval toward recent date ranges (e.g. last 30–90 days) before or during synthesis.  
2. Optionally combine with [OPP-022 archived](../../opportunities/archive/OPP-022-ask-synthesis-detail-level.md) for answer depth; this bug is **retrieval/ranking**, not only verbosity.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- Related: [OPP-022 archived — ask synthesis detail](../../opportunities/archive/OPP-022-ask-synthesis-detail-level.md)  
- Feedback: `riptest/feedback/bug-ask-stale-data-no-recency-weighting.md` (processed 2026-04-11)
