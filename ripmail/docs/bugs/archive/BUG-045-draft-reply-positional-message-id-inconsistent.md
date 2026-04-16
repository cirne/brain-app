# BUG-045: `draft reply` / `draft forward` require `--message-id` while `read` / `thread` use positional id

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** draft, cli, ux, agent-first

**Design lens:** [Agent-first](../../VISION.md) — the same conceptual argument (message id) should use one convention across primitives so agents do not waste a round-trip on `--help`.

---

## Summary

`ripmail read <id>`, `ripmail thread <id>`, and `ripmail attachment list <id>` take the message id positionally. `ripmail draft reply` and `draft forward` require `--message-id <id>`. Passing the id positionally is mis-parsed as an unrecognized flag, and the error suggests a flag rather than a consistent positional pattern.

**Example (reported):**

```bash
ripmail draft reply "1846514342...@..." --body "Thanks"
```

stderr: `unrecognized flag 1846514342@...; ignoring`  
then: missing `--message-id`.

---

## Reported context

- **Session:** ztest / agent UAT, 2026-04-11  
- **ripmail:** 0.1.6  
- **Relates to:** [BUG-044](BUG-044-attachment-list-ignores-message-id-flag.md) (opposite inconsistency on `attachment list`)

---

## Recommendations

1. Accept optional positional `<MESSAGE_ID>` for `draft reply` / `draft forward` (same as `read`), keeping `--message-id` as an optional alias for scripts.  
2. If positional is rejected short-term, improve the error to: “use `--message-id <id>`; positional id is not supported for this subcommand.”

---

## References

- Vision: [VISION.md](../../VISION.md)  
- Feedback: `riptest/feedback/ux-draft-reply-positional-vs-flag-inconsistency.md` (processed 2026-04-11)
