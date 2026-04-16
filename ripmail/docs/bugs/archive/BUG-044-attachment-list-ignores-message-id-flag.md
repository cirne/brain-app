# BUG-044: `attachment list` silently ignores `--message-id` and returns empty JSON

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** attachments, cli, errors, agent-first

**Design lens:** [Agent-first](../../VISION.md) — unknown flags must not yield success with an empty structured result; that is indistinguishable from “no attachments.”

---

## Summary

Passing `--message-id <id>` (consistent with `draft reply`) produces stderr such as `unrecognized flag --message-id; ignoring`, exit **0**, and stdout `[]`. The positional form works.

**Impact:** Agents assume there are no attachments when the message actually has attachments — a data-loss class failure.

---

## Reported context

```bash
ripmail attachment list --message-id "<id>"   # → [] , exit 0
ripmail attachment list "<id>"                # → correct attachments
```

- **Session:** ztest / agent UAT, 2026-04-11  
- **ripmail:** 0.1.6  

---

## Root causes

CLI accepts extra flags with warn-and-ignore behavior for this subcommand while still treating the invocation as successful with no message id resolved.

---

## Recommendations

1. **Preferred:** Accept `--message-id` as an alias for the message id argument (align with `draft reply`), **or**  
2. Fail with exit ≠ 0 and usage that states message id is positional: `ripmail attachment list <MESSAGE_ID>`.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- Feedback: `riptest/feedback/bug-attachment-list-silent-flag-ignore.md` (processed 2026-04-11)
