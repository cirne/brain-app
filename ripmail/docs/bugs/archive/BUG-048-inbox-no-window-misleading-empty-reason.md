# BUG-048: `ripmail inbox` with no window args returns misleading `emptyReason: "no_local_mail"` when mail exists

**Status:** Fixed (2026-04-11). **Created:** 2026-04-11. **Tags:** inbox, config, ux, agent-first

**Design lens:** [Agent-first](../../VISION.md) — empty results must explain the true reason (window vs no data); defaults should match documented behavior.

---

## Summary

With `inbox` unset or `null` in `config.json` (no `inbox.defaultWindow`), running **`ripmail inbox`** with no window argument returned zero items and:

`emptyReason: "no_local_mail"`

even when tens of thousands of messages were indexed. **`ripmail inbox 30d`** (or other explicit windows) worked.

**Expected:** Either apply the documented default window (e.g. 24h per [AGENTS.md](../../AGENTS.md)) when omitted, or return a distinct `emptyReason` / stderr hint that the window is unset or invalid — not “no local mail.”

---

## Reported context

- **Config:** `"inbox": null`  
- **Status:** ~26k messages indexed  
- **ripmail:** 0.1.6  
- **Session:** ztest / agent UAT, 2026-04-11  

---

## Root causes (hypothesis)

Null `inbox.defaultWindow` resolves to a zero-width or invalid window while still mapping to the generic “no local mail” empty reason.

---

## Recommendations

1. When `inbox` section is missing, apply the same default window as documented for new installs.  
2. Add an `emptyReason` value such as `no_window_config` or `invalid_default_window` when applicable.  
3. Integration test: `inbox` with null config vs explicit `24h`.

---

## References

- Vision: [VISION.md](../../VISION.md)  
- Feedback: `riptest/feedback/bug-inbox-no-args-empty-no-local-mail.md` (processed 2026-04-11)
