# Archived: OPP-098 — Google Calendar — incremental ripmail refresh

**Status: Archived (2026-05-12).** Removed from the active backlog (shipped or no longer pursued).


---

## Original spec (historical)

### OPP-098: Google Calendar — incremental ripmail refresh (syncToken / deltas)

**Status:** Proposed  
**Area:** ripmail sync — **`googleCalendar`** sources  
**Updated:** 2026-05-07

**Tags:** `ripmail` · `calendar` · `google` · `performance`

**Related:** [`src/server/ripmail/calendar.ts`](../../../src/server/ripmail/calendar.ts) (Google Calendar indexing surface); calendar **`sync_token`** in SQLite; Rust-era reference ([ripmail-rust-snapshot.md](../../architecture/ripmail-rust-snapshot.md)); agent calendar surface **[OPP-070](./OPP-070-full-calendar-read-write-agent-surface.md)**; archived **[OPP-069](./OPP-069-calendar-token-efficiency.md)** (tool/token shape — orthogonal to **refresh wall time**).

---

## Problem

Every **`ripmail refresh`** run **deletes all indexed events** for the calendar source (`delete_source_events`) and **re-fetches** a **fixed wide window** (~**2 years** past → ~**3 years** future) with **`singleEvents=true`**, paginating **`maxResults=250`** per calendar. On real accounts this routinely means **thousands** of HTTP rows and **~10–15+ s** of wall clock **even when nothing changed**, and it **dominates** perceived refresh latency when mail uses the Gmail API fast path ([archived OPP-097](./OPP-097-gmail-rest-api-incremental-refresh.md)).

Tokens (**`nextSyncToken`**) are already **persisted per `(source_id, calendar_id)`** in places, but the **full wipe + full replay** pattern prevents steady-state incremental behavior.

---

## Direction

1. **Incremental list when sync token valid**  
   Use Google Calendar **`events.list`** with **`syncToken`** (and **`showDeleted=true`** as required by Google when syncing) so routine refresh pulls **only deltas**. Keep a **periodic or forced full reconcile** (e.g. weekly, `--force`, schema bump, or explicit subcommand) to bound drift.

2. **Avoid unconditional `delete_source_events`** on hot path**  
   Prefer **upsert + tombstone** from incremental responses; only bulk-delete local rows when doing a **full resync** or calendar removal.

3. **Narrow default window for cold / token-miss paths** (optional product choice)  
   If a full replay is required, consider shrinking default **`timeMin`/`timeMax`** vs today’s 2y/3y unless user explicitly widens — trades completeness for latency (document clearly).

4. **Observability**  
   Extend **`sync.log`** (and optional JSON metrics) with: `gcal_incremental` vs `gcal_full`, phase durations, event counts, HTTP pages, token **410** resets.

5. **Correctness**  
   Handle **`410 Gone`** / invalid sync token (Google forces full sync); idempotent **`upsert_event`**; recurring **`singleEvents`** semantics unchanged unless deliberately revised.

---

## Risks

- **Semantic change:** switching from “delete all then refill” to incremental requires careful handling of **cancelled**/**moved** instances and **calendar membership** changes.
- **SQLite contention:** calendar thread already competes with mail refresh; faster calendar reduces contention but does not remove it.
- **Quota:** incremental **`events.list`** should reduce calls; verify against Google Calendar API usage docs.

---

## Suggested acceptance criteria

- [ ] Steady-state **`ripmail refresh`** for OAuth Google Calendar uses **`syncToken`** when present; logs show incremental path.
- [ ] **410** / missing token triggers **documented full sync** and restores a valid token.
- [ ] **`events_written`** / duration on “no changes” drops to **sub-second or low-second** order on typical accounts (measure p50/p95).
- [ ] Tests for token persistence, 410 recovery, and deleted-event tombstone behavior (unit + narrow integration).

---

## References

- [Calendar API — Synchronize resources incrementally](https://developers.google.com/calendar/api/guides/sync)
- [Events: list](https://developers.google.com/calendar/api/v3/reference/events/list)
