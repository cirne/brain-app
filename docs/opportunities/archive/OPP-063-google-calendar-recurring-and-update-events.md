# OPP-063: Google Calendar — recurring series and updating events

**Status:** Archived (2026-04-30) — **Superseded by** [OPP-070](../OPP-070-full-calendar-read-write-agent-surface.md) (single umbrella for **recurring create**, **update_event**, **cancel_event**, **delete_event**, and related ripmail primitives).

**Tags:** `calendar` · `agent` · `google`

**Related:** [OPP-019](../OPP-019-gmail-first-class-brain.md); [`calendar` tool](../../../src/server/agent/tools/calendarTools.ts); [BUG-027](../../bugs/archive/BUG-027-calendar-create-event-empty-list-rejects-source.md); [OPP-070](../OPP-070-full-calendar-read-write-agent-surface.md) (tracking).

---

## One-line summary

Let the assistant **create recurring meetings** (e.g. weekly RRULE) and **patch existing Google Calendar events** instead of only **one-off** `create_event`.

---

## Problem

The agent `calendar` tool documents **single-instance** `create_event` for Google Calendar. Users cannot:

- Turn a one-time event into a **recurring series** (e.g. every Monday 9:00–9:30).
- **Update** an existing event’s time, recurrence, title, or location via Braintunnel — they are sent to the Google Calendar UI manually.

Google Calendar’s API supports recurrence and event updates; the gap is **product surface** (ripmail CLI + brain-app tool schema + OAuth scope checks).

---

## Proposed direction

1. **Ripmail:** extend `calendar create-event` (or add `update-event`) with optional **recurrence** (start from RFC5545 RRULE or a small structured preset: daily / weekly / weekdays / monthly + end date or count). Persist and return event ids consistently for follow-up edits.
2. **Brain-app:** extend `calendar` tool with `op=update_event` (or merge into a single `upsert` shape), threading **event id** + **calendar id** + **source**; document when to create vs patch in the tool description.
3. **Scopes:** confirm `calendar.events` (or as today) suffices for insert/patch; no new consent category if already granted.
4. **Indexing:** keep **reindex after write** behavior so local cache matches Google.

---

## User feedback

- In-app issue **#14** (`2026-04-29`). Reporter note: *appHint: Google Calendar tool supports single-event creation only.*
