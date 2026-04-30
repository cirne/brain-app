---
name: calendar
description: Manage calendars, schedule meetings, recurring events, edits, cancellations, and visibility. Use when the user asks to see their schedule, change events on Google Calendar, hide/show calendars, or update/delete occurrences.
---

# Calendar Management Skill

This skill provides guidance for managing calendars and scheduling using the `calendar` tool.

**Writes** (`create_event`, `update_event`, `cancel_event`, `delete_event`) target **Google Calendar** only (`googleCalendar` source + `calendar.events`). Other calendar kinds (Apple, ICS subscriptions, etc.) are **read-only** through this stack.

## Core Tool: `calendar`

The `calendar` tool is the primary interface for all calendar-related actions.

### Event identity (mutations)

For write ops, pass **`event_id`** as the compound **`id`** from **`op: 'events'`** or **`search`** hints: **`"<sourceId>:<uid>"`**. The **`uid`** segment is the indexed Google event resource id (used as `ripmail calendar … --event-id`).

### 1. Visibility Management (Hide/Show)

To control which calendars are visible in the UI or included in default queries, use `op: 'configure_source'`.

- **`calendar_ids`**: The list of all calendars that should be "synced" or available in the UI.
- **`default_calendar_ids`**: The subset of calendars that should be "shown" by default in the main view.
- **`source`**: The ID of the account (e.g., Google, Apple) being configured.

**Workflow to hide/show:**
1. Call `op: 'list_calendars'` to see all available IDs for a source.
2. Call `op: 'configure_source'` with the updated `calendar_ids` and `default_calendar_ids`.

### 2. Accessing Events

- **`op: 'events'`**: Query events for a specific date range.
    - Use `start` and `end` (YYYY-MM-DD).
    - Optionally pass `calendar_ids` to limit to specific calendars (tier still follows window length — **narrow** `start`/`end` for more detail).
    - **`search`**: FTS keyword within `start`/`end`. Results are **compact hints** (capped, max ~40) plus **`totalMatchCount`** in the tool payload — not full event rows. If the right event is missing, narrow the date range or refine the keyword and call again.

### 2b. Adaptive resolution (date window only)

`op: 'events'` without **`search`** uses tiering from **how many days** are in `start`/`end` (there is **no** parameter to force a full dump):

| Window | Tier | Behavior |
|--------|------|----------|
| **> 30 days** | Landmarks | All-day + timed events **≥ 4 hours** only; **recurring** instances omitted. |
| **10–30 days** | Overview | Recurring omitted; **timed** events omit `description` and `location` (all-day keeps those fields). |
| **< 10 days** | Full rows | All events in range with full agent row fields (still capped — see tool description). |

The tool appends a **`[resolution: …]`** hint when tier isn’t “full”, and may append **`[truncated: …]`** if the row cap is hit — **narrow the range** or **`search`**.

**Agent guidance:**
- **Default:** choose `start`/`end`; read hints for what was filtered.
- **Named topic / trip / event:** use **`search`** (plus a sensible range).
- **More recurring or timed detail** across a wide span: **shorter windows** (<10 days) and/or **`search`**, not a bigger single call.

### 3. Creating Events (Google Calendar)

- **`op: 'create_event'`**: Add an event to the user’s **Google** calendar (requires a `googleCalendar` source and OAuth scope `calendar.events`). Not supported for Apple or ICS sources.
- **`source`**: The `sourceId` from `op: 'list_calendars'` for that Google account (often ends in `-gcal`).
- **`title`**: Event summary (required).
- **`calendar_id`**: Optional; defaults to `primary`.
- **All-day**: Set `all_day: true` and `all_day_date` to one local day (`YYYY-MM-DD`).
- **Timed**: Omit `all_day` or set `all_day: false`, and pass `event_start` and `event_end` as **RFC3339** (include offset or `Z` so the time is unambiguous; align with the user’s timezone from context).
- Optional `description` and `location`.
- After a successful create, the local index is refreshed in the background; you can call `op: 'events'` to confirm the new event once indexing completes.

**Recurrence (optional on create/update):**

- **`recurrence`**: Either a preset — `daily`, `weekdays`, `weekly`, `biweekly`, `monthly`, `yearly` — or a **raw RRULE** line (e.g. `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR`).
- **`recurrence_count`**: Stop after **`N`** occurrences (optional).
- **`recurrence_until`**: End recurrence after this **`YYYY-MM-DD`** inclusive (optional; complements RRULE COUNT/UNTIL in ripmail).
- Do **not** pass both a preset name and an RRULE string in **`recurrence`** — pick one.

### 4. Updating events (`update_event`)

- **`event_id`** (required): compound id from **`events`** / **`search`**.
- **`calendar_id`** (optional): defaults to `primary`.
- Patch fields (at least one required): **`title`**, **`description`**, **`location`**, **`event_start`** + **`event_end`** (timed, RFC3339), **`all_day`** + **`all_day_date`**, or recurrence fields (**`recurrence`**, **`recurrence_count`**, **`recurrence_until`**).
- For recurring masters vs instances: the stored **`uid`** is what Google identifies; narrowing to one instance typically uses an instance **`uid`** ending in **`_YYYYMMDDTHHmmssZ`**.

### 5. Cancelling events (`cancel_event`)

**Cancel** marks the event **cancelled** (organizer path; attendees are notified depending on provider). Use when the meeting should formally be called off.

- **`event_id`**, **`calendar_id`**, **`scope`**:
  - **`this`**: Cancel this occurrence (default).
  - **`future`**: Cancel **this occurrence and future** occurrences in the series (truncates recurrence after the pivot instance).
  - **`all`**: Cancel the entire series (`scope=all` resolves to the recurrence master).

**Confirmation:** Quote **title**, **start time**, and **`scope`** (especially recurring) before running **`cancel_event`**.

### 6. Deleting events (`delete_event`)

**Delete** removes the event (**hard delete**). Use **only** when the user wants it gone—not the same UX as cancelling for attendee-facing meetings.

- **`scope`**: **`this`** (default) or **`all`** (series master via id resolution). **`future` is invalid** — use **`cancel_event`** with **`future`** instead.

**Confirmation:** Same as cancel — quote title + time + series vs single instance.

### 7. Scheduling and Assistance

- For complex scheduling assistance (e.g., finding times with others), the system can forward requests to `howie@howie.ai`.
- When the user asks to "schedule a meeting," the agent should use the `calendar` tool to check for conflicts first, then add or change events via **`create_event`** / **`update_event`** when asked, or use external scheduling integrations if configured.

## Best Practices for the Agent

- **Context Awareness**: Before scheduling, always check the user's current schedule using `op: 'events'` for the relevant date range (or `search` when they name a specific trip or topic).
- **Source Discovery**: If the user refers to a calendar by name but you don't have the ID, use `op: 'list_calendars'` to find the matching `source` and `id`.
- **Incremental Configuration**: When changing visibility, preserve the existing configuration unless explicitly asked to overwrite it.
- **Timezones**: For `op: 'events'`, `start` and `end` are `YYYY-MM-DD`. For `create_event` timed mode, use RFC3339 in `event_start` / `event_end` and the user’s local timezone from context when translating "tomorrow at 3pm" into concrete instants.
- **Token efficiency**: Prefer **`search`** for keyword-specific questions over loading an entire quarter and reading it in the transcript.
- **Destructive confirmations**: Before **`cancel_event`** or **`delete_event`**, briefly restate **event title**, **start** (human-readable), and for recurring rows whether you are affecting **this instance**, **future**, or **the whole series** — e.g. "Cancel **Team standup** on Wed May 1 at 10:00 (**this occurrence only**, `scope=this`)?".
