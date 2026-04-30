# OPP-069: Calendar tool — token efficiency and adaptive resolution

**Status:** Partially shipped  
**Tags:** `calendar` · `agent` · `ripmail` · `onboarding`  

**Related:** [`calendar` tool](../../src/server/agent/tools/calendarTools.ts); [`calendarRipmail.ts`](../../src/server/lib/calendar/calendarRipmail.ts); [`calendarCache.ts`](../../src/server/lib/calendar/calendarCache.ts); [OPP-054](OPP-054-guided-onboarding-agent.md) (onboarding — configure calendars); [OPP-063](OPP-063-google-calendar-recurring-and-update-events.md) (create recurring / update in Google).

---

## One-line summary

Cut **calendar tool** token bloat by **primary-calendar scope**, **onboarding-driven defaults**, and **adaptive resolution** (tiered event detail by window length + payload), with **explicit recurrence** in ripmail JSON so standing meetings can be filtered in wide views.

---

## Problem

The `calendar` tool’s `op: 'events'` loads **all default calendars** for a date range with no output-size guard. Users often have **many** subscribed calendars (other people’s, teams, holidays). A single broad query can return **90k+ characters** of JSON. Per-event description truncation already exists; the bloat is **event count × calendars**, especially **Google expanded recurring instances** (`singleEvents=true` → one DB row per occurrence).

---

## Part 1 — Primary calendar set + onboarding (open — OPP-054)

Today `configure_source` distinguishes `calendar_ids` (synced) and `default_calendar_ids` (default query scope), but many installs never narrow defaults.

1. **Hub:** explicit **primary calendars** — a small named subset of `default_calendar_ids` that the agent uses for undifferentiated schedule queries unless the user asks for “all calendars” or names a calendar.
2. **Onboarding ([OPP-054](OPP-054-guided-onboarding-agent.md) — “configure calendars”):**
   - Call `op: 'list_calendars'`.
   - Sample a recent narrow window of events per calendar if needed.
   - Cross-reference names and organizer emails with `wiki/me.md` (user’s name, employer, collaborators) to separate **my calendars** from visibility-only.
   - Propose a primary set with short rationale; user confirms or overrides; persist via `op: 'configure_source'`.

---

## Part 2 — Adaptive resolution (shipped)

**Implemented** in [`calendarTools.ts`](../../src/server/agent/tools/calendarTools.ts) + [`calendarCache.ts`](../../src/server/lib/calendar/calendarCache.ts):

- **Landmarks** (`>30` days): all-day + timed **≥4h**; recurring omitted; `[resolution: …]` hint + `details.resolutionMeta`.
- **Overview** (`10–30` days): recurring omitted; timed rows omit `description`/`location` in agent JSON; hint + `resolutionMeta`.
- **Full** (`<10` days, or `resolution: 'full'`, or explicit `calendar_ids`): prior behavior.
- **`search`** on `op=events`: `ripmail calendar search` FTS over the date range; full detail; bypasses adaptive tiers (token-efficient for “when is Cabo?”).

Optional **payload-size** compaction for Full tier was described in early drafts; not implemented — reopen if huge single-day payloads still appear.

---

## Part 3 — Recurrence in ripmail JSON (shipped)

`calendar_events` stores `rrule` (ICS) and `recurrence_json` (Google). `calendar range --json` includes **`rrule`** and **`recurrenceJson`**. Brain maps **`CalendarEvent.recurring`** for tier filtering.

---

## Implementation checklist (brain-app)

- [ ] Hub UI for primary calendar set.
- [ ] Onboarding flow integration (OPP-054).
- [x] `calendar` tool: `resolution` + `search` + adaptive tier logic + `resolutionMeta` + hints.
- [x] Skill [`.agents/skills/calendar/SKILL.md`](../../.agents/skills/calendar/SKILL.md): adaptive tiers + `search`.
