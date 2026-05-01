# OPP-070: Full calendar read/write — agent surface, ripmail primitives, UX guardrails

**Status:** Mostly shipped (2026-04) — **residual:** onboarding / primary-calendar UX ([OPP-054](OPP-054-guided-onboarding-agent.md)), acceptance checklist audit, edge-case polish.  
**Tags:** `calendar` · `agent` · `ripmail` · `google`  

**Reality check:** `**calendar`** in [`calendarTools.ts`](../../src/server/agent/tools/calendarTools.ts) exposes **`create_event`** (recurrence / RRULE), **`update_event`**, **`cancel_event`**, **`delete_event`** backed by **`ripmail calendar`** (`create-event`, `update-event`, `cancel-event`, `delete-event`). Reads use adaptive tiers + **`search`** ([archived OPP-069](archive/OPP-069-calendar-token-efficiency.md)). Treat the **Problem** and **Acceptance** sections below as the **original spec**; many boxes are already satisfied in `main`.

**Related:** [archived OPP-063](archive/OPP-063-google-calendar-recurring-and-update-events.md) (**superseded** by this doc); [archived OPP-069](archive/OPP-069-calendar-token-efficiency.md) (read path — **shipped**; primary calendars remain [OPP-054](OPP-054-guided-onboarding-agent.md)); [`calendar` tool](../../src/server/agent/tools/calendarTools.ts); [`.agents/skills/calendar/SKILL.md`](../../.agents/skills/calendar/SKILL.md); [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) (OAuth verification if scopes expand).

---

## One-line summary

Give the assistant **real calendar lifecycle control** (not only **single-instance create**): **recurring create**, **update** (patch time, title, location, recurrence), **cancel**, **delete**, and **move/reschedule** — implemented in **ripmail** (Google Calendar API), exposed as **one coherent `calendar` tool** in brain-app, with **clear provider limits** and **safe UX defaults**.

---

## Problem (historical — pre-2026-04)

The stack was **read-heavy, write-narrow** until **`calendar`** gained full mutation **`op`** values:

- **`calendar` `op=events`** (plus [adaptive tiers + search](archive/OPP-069-calendar-token-efficiency.md)) gives a strong **read** path.
- Previously **`op=create_event`** was **single-instance** only; **update** / **recurring** / **cancel** / **delete** were missing from the agent surface even when OAuth had **`calendar.events`**.

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

**As of 2026-04-30:** ripmail **`calendar`** implements **create-event** (recurrence), **update-event**, **cancel-event**, **delete-event** with JSON stdout; brain-app maps them in **`createCalendarTool`**. Use this list to audit **tests**, **docs**, and **manual smoke** — not as “not started.”

### Ripmail

- [x] **`create-event`** supports **recurrence** (preset and/or RRULE + end) with **`--json`** returning stable ids for mutations.
- [x] CLI **update**, **cancel**, and **delete** with **`--json`** (verify error shapes on failure in tests / smoke).
- [x] **Recurring:** **scope** for cancel/delete (and update where applicable); covered in CLI + agent plumbing.
- [x] Post-mutation **refresh** path (`runCalendarRefreshAgent`) after agent writes.

### Brain-app

- [x] `calendar` tool **`op`** includes **`update_event`**, **`cancel_event`**, **`delete_event`**, and **`create_event`** recurrence parameters; validation in **`calendarTools.ts`**.
- [x] Single top-level **`calendar`** tool (no separate write tool).
- [ ] Expand automated tests: happy paths + unsupported source + missing fields (**audit** `calendarTools` / integration coverage).
- [ ] [`.agents/skills/calendar/SKILL.md`](../../.agents/skills/calendar/SKILL.md): keep aligned with shipped **`op`** list and recurring **scope** semantics.

### Cross-cutting

- [ ] Manual smoke on a live mailbox: recurring create → patch → cancel instance vs series → verify Google UI + **`op=events`**.
- [ ] **Feedback #14:** triage registry notes **core mutations shipped**; file new bugs for concrete regressions ([registry](../feedback-processed/registry.md)).

---

## Non-goals (v1)

- **Write** to **ICS subscription** or **pure read-only** calendars (detect and error).
- **Apple EventKit** two-way sync (desktop-only; separate epic).
- **Organizer transfer** or **attendee-only** edit rights edge cases beyond clear API errors surfaced to the model.
