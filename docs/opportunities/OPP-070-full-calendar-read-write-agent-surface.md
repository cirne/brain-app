# OPP-070: Full calendar read/write — agent surface, ripmail primitives, UX guardrails

**Status:** Open  
**Tags:** `calendar` · `agent` · `ripmail` · `google`  

**Related:** [archived OPP-063](archive/OPP-063-google-calendar-recurring-and-update-events.md) (**superseded** — recurring create + patch scope folded here); [archived OPP-069](archive/OPP-069-calendar-token-efficiency.md) (read path: tiers, search — **shipped**; primary calendars remain [OPP-054](OPP-054-guided-onboarding-agent.md)); [`calendar` tool](../../src/server/agent/tools/calendarTools.ts); [`.agents/skills/calendar/SKILL.md`](../../.agents/skills/calendar/SKILL.md); [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) (OAuth verification if scopes or sensitive operations expand).

---

## One-line summary

Give the assistant **real calendar lifecycle control** (not only **single-instance create**): **recurring create**, **update** (patch time, title, location, recurrence), **cancel**, **delete**, and **move/reschedule** — implemented once in **ripmail** (Google Calendar API), exposed as **one coherent `calendar` tool** in brain-app, with **clear provider limits** and **safe UX defaults**.

---

## Problem

Today the stack is **read-heavy, write-narrow**:

- **`calendar` `op=events`** (plus [adaptive tiers + search](archive/OPP-069-calendar-token-efficiency.md)) gives a strong **read** path backed by the local ripmail index.
- **`op=create_event`** adds **single-instance** Google events only (no RRULE / recurrence presets).
- Users cannot **update** an existing event, **create a recurring series**, **cancel** meetings, **delete** events, or **reschedule** via the agent — even though Gmail OAuth already requests **`https://www.googleapis.com/auth/calendar.events`** (sufficient for insert/update/delete on Google’s side once implemented).

Users hit this as “**I can see my calendar but the assistant can’t act on it**” — screenshot-level friction for vacations, conflicts, standups, and routine hygiene.

---

## Supersedes OPP-063 (explicit scope)

The following were tracked as **[archived OPP-063](archive/OPP-063-google-calendar-recurring-and-update-events.md)** and **must** be satisfied when OPP-070 ships:

- **`create_event` + recurrence:** optional RRULE or small presets (daily / weekly / weekdays / monthly + end date or count); consistent **event ids** returned for follow-up **`update_event`** / **`cancel_event`**.
- **`update_event`:** patch time, title, location, description, recurrence (organizer / permissions as API allows).
- **Scopes:** confirm **`calendar.events`** suffices for insert/patch/cancel/delete (expected: yes); re-consent only if product changes scope.
- **Indexing:** **`runCalendarRefreshAgent`** (or incremental sync) after writes so **`op=events`** matches Google.

**User feedback:** in-app **#14** — calendar tool limited to single-event creation; triage registry should point **here** once shipped.

---

## Design principles

1. **Ripmail owns provider I/O.** Add or extend **`ripmail calendar …`** subcommands (JSON stdout, consistent error shapes) so **brain-app stays a thin wrapper** (`execRipmailAsync` + parameter mapping). Avoid duplicating Google HTTP in TypeScript.
2. **One agent tool, explicit operations.** Keep the **`calendar`** tool name; extend **`op`** with **`update_event`**, **`cancel_event`**, **`delete_event`**, and extend **`create_event`** for recurrence (and optionally **`move_event`** as sugar over time patch). No second “`calendar_write`” tool — reduces routing mistakes and keeps tool-registry UX simple.
3. **Stable event identity.** Mutations MUST accept identifiers the model already sees from **`op=events`** / search **`hints`**: e.g. **indexed `id` / `uid`**, plus **`source`** and **`calendar_id`**. Document the mapping in the tool description and skill so the LLM does not guess.
4. **Separate “cancel” vs “delete” semantics** (Google-aligned):
   - **Cancel** — mark instance or series as cancelled (organizer-facing; attendees see cancellation).
   - **Delete** — remove event (and for recurring: **instance vs series** MUST be explicit in CLI + tool params).
5. **Provider matrix in docs and errors.** Mutations return **`supported: false`** with a **short reason** for **ICS-only**, **subscription**, or **future Apple** sources — same pattern as **`create_event`** today (Google-only until otherwise implemented).
6. **Single ripmail design pass.** One **`calendar` patch/update** primitive (plus **`create-event`** recurrence flags) should handle time, title, location, description, recurrence, and cancellation status — avoid parallel overlapping CLIs.

---

## Proposed tool shape (brain-app)

Illustrative — final names follow ripmail CLI alignment:

| `op` | Purpose | Key params (conceptual) |
|------|---------|-------------------------|
| `events` | (existing) read + search + tiers | `start`, `end`, optional `search`, `calendar_ids` |
| `list_calendars` | (existing) | optional `source` |
| `configure_source` | (existing) | `source`, `calendar_ids`, optional `default_calendar_ids` |
| `create_event` | (extend) timed / all-day + **optional recurrence** | existing fields + recurrence preset or RRULE + end/count |
| `update_event` | Patch fields on an existing event | `source`, `calendar_id`, **`event_id`** (or `uid` + disambiguation), optional time, title, location, description, recurrence |
| `cancel_event` | Cancel occurrence or series | `source`, `calendar_id`, event ref, **`scope`**: `this` \| `future` \| `all` for recurring |
| `delete_event` | Hard delete | same identity + scope model |

**Optional later:** `rsvp` / `respond_to_invite` if read path exposes attendee status and product wants inbox-like flows — out of scope for v1 unless demand is clear.

---

## UX and agent behavior (product)

- **Narrow confirmation for destructive ops.** Skill text SHOULD tell the model to **quote event title + start time** and, for recurring events, **state series vs single instance** before `cancel_event` / `delete_event`. (No separate UI gate in v1 unless compliance asks for it.)
- **Honest capability string.** System or skill copy: “**Google Calendar** via connected account; not Apple Calendar / read-only feeds.”
- **Post-mutation refresh.** Reuse **`runCalendarRefreshAgent(source)`** after successful writes so **`op=events`** matches Google quickly.

---

## OAuth and policy

- **Default:** existing **`calendar.events`** scope — verify no additional scope for cancel/delete API calls (expected: none).
- If **incremental read scopes** or **restricted verification** ever force **readonly** installs, mutations MUST **fail closed** with a user-action hint (“Reconnect Google” / “Grant calendar write”).

---

## Acceptance criteria

### Ripmail

- [ ] **`create-event`** (or equivalent) supports **recurrence** (preset and/or RRULE + end) with **`--json`** returning stable **`eventId`** / ids needed for follow-up mutations.
- [ ] Documented CLI for **update**, **cancel**, and **delete** (names TBD) with **`--json`** output including **`ok`**, **`eventId`**, **`htmlLink`** (when applicable), and structured **`error`** on failure.
- [ ] **Recurring:** explicit flags or enums for **this instance** vs **all instances** vs **this and following** on **cancel** / **delete** / **update** where API requires it; integration or unit tests for Google payload construction.
- [ ] After mutation, **incremental sync or targeted fetch** updates local `calendar_events` so a subsequent **`calendar range`** reflects the change (or documents acceptable lag + `refresh` hint).

### Brain-app

- [ ] `calendar` tool **`op`** includes **`update_event`**, **`cancel_event`**, **`delete_event`**, and **`create_event`** gains recurrence parameters; parameters validated in **`calendarTools.ts`** with clear **`Error`** messages (missing `source`, missing event ref, unsupported source kind).
- [ ] **`createAgentTools` / `ALL_AGENT_TOOL_NAMES`** unchanged except **no new top-level tool names** (still a single `calendar` tool).
- [ ] Tests in **`src/server/agent/tools.test.ts`** (or **`calendarTools`-focused test file**) covering: happy path JSON parse, unsupported source, missing required fields.
- [ ] [`.agents/skills/calendar/SKILL.md`](../../.agents/skills/calendar/SKILL.md) updated: when to use create vs update vs cancel vs delete; recurring create + scope; Google-only mutations.

### Cross-cutting

- [ ] Manual smoke: **create recurring** event from chat; **patch** time/title; **cancel** one instance vs series; confirm in Google Calendar UI and **`op=events`** after refresh.
- [ ] **Feedback #14:** mark resolved in [feedback registry](../feedback-processed/registry.md) when shipped.

---

## Non-goals (v1)

- **Write** to **ICS subscription** or **pure read-only** calendars (detect and error).
- **Apple EventKit** two-way sync (desktop-only; separate epic).
- **Organizer transfer** or **attendee-only** edit rights edge cases beyond clear API errors surfaced to the model.
