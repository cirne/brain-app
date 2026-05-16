# BUG-062: Calendar day query — agent queries only `primary`, empty result reads as “no events”

**Status:** **Fixed (2026-05-16).** Lone `calendar_ids: ["primary"]` maps to Hub `defaultCalendars` when they differ; tool copy and assistant prompt steer day queries to omit `calendar_ids` and not claim an empty day without checking defaults.  
**Tags:** `calendar` · `agent` · `hosted`

**Related:** [BUG-027 archived](archive/BUG-027-calendar-create-event-empty-list-rejects-source.md) (OAuth / empty `list_calendars` — fixed) · [BUG-021 archived](archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md) (timezone display — fixed) · [`calendarTools.ts`](../../src/server/agent/tools/calendarTools.ts) · [`resolveRipmailRangeCalendarFilter`](../../src/server/lib/calendar/calendarRipmail.ts) · [`collectGoogleCalendarDefaultCalendarIds`](../../src/server/ripmail/sync/config.ts)

---

## Summary

For a natural “check calendar for Monday” request, the assistant queried **`calendar` `op=events`** with **`calendar_ids: ["primary"]`**, got **no events**, and answered as if the user’s day were clear. The tool response included the standard **HINT** that Hub defaults and other synced calendar IDs may apply — so the answer was **misleading** if events lived on a non-primary calendar, defaults were not configured, or indexed data was stale.

Distinct from **BUG-027** (OAuth / empty calendar list) and **BUG-021** (timezone bucketing). This is **agent query scope + user-facing interpretation** when the indexed range is empty but other calendars exist.

---

## Repro (from in-app feedback **#21**)

1. User: “Check calendar for monday” (example date window **2026-05-18**).
2. Assistant calls **`calendar`** with:
   - `op=events`
   - `start=2026-05-18`, `end=2026-05-18`
   - `calendar_ids=["primary"]`
3. Tool returns **no events** plus hint: queries use Hub **default** Google calendars unless `calendar_ids` are passed; other calendar IDs may exist; sync may be needed.
4. Assistant tells the user there are **no events on the default calendar** — which can imply a full schedule check when only **`primary`** was queried.

---

## Expected

- For “what’s on my day / Monday” without naming a calendar: **omit `calendar_ids`** so **`resolveRipmailRangeCalendarFilter`** applies Hub **`defaultCalendars`** (or sole synced id), **or** call **`list_calendars`** and query the configured defaults — not an ad-hoc `["primary"]` unless the user asked for primary.
- When the tool returns **no rows** and the **HINT** lists other calendar IDs: **retry** with those ids (or defaults from config), mention **sync/index lag** if relevant, and **do not** state the day is empty unless all relevant calendars were checked.
- User-facing copy should distinguish **“nothing on the calendars I checked”** vs **“your calendar is free.”**

---

## Likely fix direction

1. **Prompt / tool description:** steer day-range reads to **omit `calendar_ids`** unless the user names a calendar; discourage assuming Google’s `primary` id matches Hub defaults.
2. **Agent eval (optional):** fixture with events on a non-`primary` synced calendar; assert the model does not answer “no events” after a `primary`-only query when hint lists alternates.
3. **Tool UX (optional):** when `calendar_ids` is passed explicitly and results are empty but `availableCalendars` has more ids, elevate the hint or return structured `suggestedCalendarIds` so the model retries reliably.

---

## User feedback

- In-app issue **#21** (`2026-05-16T22:20:26.339Z`).
