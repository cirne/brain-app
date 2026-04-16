# BUG-051: Long `refresh` / sync runs — vague “connection not available” on IMAP drop

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** sync, imap, errors, ux, agent-first

**Design lens:** [Agent-first](../../VISION.md) — after partial sync, stderr should state that progress may be saved and that retrying `ripmail refresh` is safe, so agents do not assume a full re-backfill is required.

---

## Summary

**Reported (Node zmail era; verify on Rust):**

During a long backfill, the IMAP connection dropped. The only message was effectively:

```text
ERROR Connection not available
```

Exit non-zero, with no hint that thousands of messages may already be persisted or that resuming is expected.

**Observed behavior that worked:** Checkpoint/resume preserved progress; **`ripmail status`** showed increased counts. The gap is **error UX**, not necessarily sync logic.

---

## Reported context

- Feedback: `riptest/feedback/bug-connection-not-available-error.md`  
- **Session:** processed 2026-04-11  

---

## Recommendations

1. Map transient IMAP disconnects to a message that includes “progress may be saved” and “run `ripmail refresh` to resume.”  
2. Consider distinguishing retryable vs permanent failures (exit code or stderr prefix).  
3. Optional: limited auto-retry with backoff before surfacing failure.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- [BUG-033 — actionable errors](BUG-033-actionable-file-not-found-errors.md)  
- Feedback: `riptest/feedback/bug-connection-not-available-error.md`
