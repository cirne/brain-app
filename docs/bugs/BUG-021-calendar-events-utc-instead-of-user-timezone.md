# BUG-021: Calendar events shown or imported in UTC instead of the user’s local timezone

**Status:** **Open.** User-visible times and/or interpretation of calendar data use **UTC** instead of the user’s **current** timezone (e.g. `America/New_York`), causing wrong wall-clock display and planning mistakes.

## Summary

When viewing or using **calendar** data in Braintunnel, event times are presented or applied as **UTC** rather than the user’s **local** (IANA) timezone. A reporter with Eastern Time expectations saw events **not** line up with their actual schedule.

## Related feedback

- In-app feedback issue **#6**, submitted **2026-04-24** (title: calendar events in UTC; expected user timezone).

## Repro (from report)

1. Use calendar features with events that are stored or returned with **UTC** timestamps.
2. Ask for upcoming events or conflict checks (e.g. “next week”).
3. **Observe** times shown or interpreted in **UTC** (or a fixed offset) instead of the user’s current timezone.
4. Compare with the same event in a native calendar app set to the user’s **local** region.

## Expected

- Event start/end and any **“when”** copy should use the user’s **resolved** timezone (device or explicit profile setting, consistent with the rest of the product).
- If only UTC is available from an API, **convert for display and for natural-language answers** at the same layer, with a clear contract for tests and regressions.

## Fix direction (investigate)

1. **Trace** where calendar payloads are read (API → JSON → agent tools → UI) and where `Date` / offset handling happens.
2. **Confirm** whether the bug is **display-only**, **agent prompt context** (LLM given UTC strings), or **sync** semantics.
3. **Prefer** a single source of user TZ (`Intl`, `America/*` IANA, or server-stored profile) and apply consistently in chat and any calendar surfaces.

## References

- Broader calendar roadmap context: [archived ripmail OPP-053](../../ripmail/docs/opportunities/archive/OPP-053-local-gateway-calendar-and-beyond.md) (Phase A shipped; this bug is in-app **semantics/UX**).
