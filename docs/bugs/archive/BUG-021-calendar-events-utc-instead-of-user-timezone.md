# BUG-021: Calendar events shown or imported in UTC instead of the user’s local timezone

**Status:** Fixed (2026-04-27). UI day columns and week bounds use local civil YYYY-MM-DD ([`src/client/lib/calendarLocalYmd.ts`](../../src/client/lib/calendarLocalYmd.ts)); timed events match days via `localYmdFromIsoInstant`, not `start.slice(0, 10)`. The calendar agent tool enriches events with `enrichCalendarEventsForAgent(..., { timeZone })` from the chat session IANA zone ([`calendarCache.ts`](../../src/server/lib/calendar/calendarCache.ts), [`createAgentTools`](../../src/server/agent/tools.ts) + [`assistantAgent.ts`](../../src/server/agent/assistantAgent.ts)). Tests: `calendarLocalYmd.test.ts`, `calendarCache.test.ts` (session `timeZone` vs UTC for late-evening instant).

**Follow-up (optional):** `ripmail calendar range` still interprets `from`/`to` as **UTC** civil days; full alignment of API query windows with the user’s local week may need a future ripmail/HTTP change.

## Summary (historical)

When viewing or using **calendar** data in Braintunnel, event times were **bucketed** or **labeled** using UTC string prefixes (`iso.slice(0, 10)`, `toISOString().slice(0, 10)`) instead of the user’s local civil date or the session IANA zone for the agent, causing wrong day columns and wrong weekday in tool JSON.

## Related feedback

- In-app feedback issue **#6**, submitted **2026-04-24** (title: calendar events in UTC; expected user timezone).

## References

- [archived ripmail OPP-053](../../ripmail/docs/opportunities/archive/OPP-053-local-gateway-calendar-and-beyond.md) (Phase A shipped).
