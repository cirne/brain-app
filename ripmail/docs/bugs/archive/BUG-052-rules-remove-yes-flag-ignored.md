# BUG-052: `ripmail rules remove` ignores `--yes` (scripts expect non-interactive confirm)

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** rules, cli, ux, agent-first

**Design lens:** [Agent-first](../../VISION.md) — destructive or automation-sensitive commands should accept explicit non-interactive flags consistently with other CLIs.

---

## Summary

**Reported (ztest UAT):**

```bash
ripmail rules remove <id> --yes
```

stderr: `unrecognized flag --yes; ignoring` (or equivalent), while the remove may still proceed depending on implementation — the flag is not a first-class argument.

Agents and scripts often pass `--yes` for idempotent automation; silent ignore is surprising.

---

## Reported context

- `riptest/feedback/ztest-rules-add-preview-2026-04-04.md`  
- **Session:** processed 2026-04-11  

---

## Recommendations

1. Add `--yes` / `-y` to `rules remove` (no-op confirm if remove is already non-interactive), **or** document that remove does not prompt and scripts should omit `--yes`.  
2. Prefer accepting `--yes` as a no-op for compatibility with muscle memory from `reset-defaults --yes`.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- Feedback: `riptest/feedback/ztest-rules-add-preview-2026-04-04.md`
