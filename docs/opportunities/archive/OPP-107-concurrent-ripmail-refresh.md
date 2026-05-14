# Archived: OPP-107 — Concurrent ripmail refresh across sources

**Status: Archived — shipped (2026-05-11).** `ripmail refresh` now dispatches selected mail and Google Calendar sources concurrently with a bounded source-level cap, isolated per-source failures, and per-source timing/count metadata. **Implementation:** [`src/server/ripmail/sync/index.ts`](../../../src/server/ripmail/sync/index.ts) · [`refresh.test.ts`](../../../src/server/ripmail/sync/refresh.test.ts)

---

# OPP-107: Concurrent ripmail refresh across sources

**Status:** Implemented  
**Area:** ripmail sync orchestration  
**Created:** 2026-05-11

**Tags:** `ripmail` · `sync` · `performance` · `sources`

**Related:** [`src/server/ripmail/sync/index.ts`](../../../src/server/ripmail/sync/index.ts), [`src/server/agent/tools/ripmailAgentTools.ts`](../../../src/server/agent/tools/ripmailAgentTools.ts), [OPP-087](./OPP-087-unified-sources-mail-local-files-future-connectors.md), [OPP-098](./OPP-098-google-calendar-incremental-sync.md)

---

## Problem

The agent-facing **`refresh_sources`** tool now gives a bounded foreground wait so fast syncs can immediately report newly surfaced inbox items. But the underlying TypeScript **`ripmail refresh`** path does not currently refresh all sources in parallel.

Today [`refresh()`](../../../src/server/ripmail/sync/index.ts):

- filters configured **IMAP/Gmail** sources and refreshes them one-by-one;
- then filters **Google Calendar** sources and refreshes them one-by-one;
- does not fan out mail + calendar at the top level;
- does not yet include first-class refresh work for every configured source kind named by the product surface (`localDir`, `googleDrive`, `appleCalendar`, `icsSubscription`, `icsFile`, etc.).

This means one slow mailbox or calendar can block the user's foreground wait from seeing fast updates from other sources, even when those sources could have completed independently.

---

## Direction

Make **`ripmail refresh`** an orchestrated multi-source refresh:

1. **Build one source task per selected source**  
   Resolve every configured `sources[]` entry into a sync task based on `kind`. `--source <id>` still scopes to one source; no source means all refreshable sources.

2. **Run tasks concurrently with bounded concurrency**  
   Use a small global limit (for example 3-4) rather than unbounded `Promise.all`. Preserve per-source internal limits, such as Gmail message fetch concurrency.

3. **Keep source failures isolated**  
   One source failing should log and return per-source error metadata without preventing other sources from finishing. Existing invalid-grant cleanup should still happen for the failing source.

4. **Cover all refreshable kinds**  
   Mail and Google Calendar are the current hot path. Add or wire refresh tasks for document/calendar source kinds as their TypeScript implementations land (`localDir`, `googleDrive`, ICS/Apple Calendar).

5. **Expose timing and counts**  
   Return or log per-source durations, kind, counts, and error state so `refresh_sources` can explain whether the bounded wait completed all sources or only a subset.

---

## Acceptance criteria

- [x] `refresh()` dispatches multiple selected sources concurrently with a documented concurrency cap.
- [x] Mailbox and Google Calendar sources can run at the same time during an all-source refresh.
- [x] A slow or failed source does not block successful completion of unrelated sources.
- [x] Tests prove concurrent dispatch order with controlled promises.
- [x] Refresh result/logs include enough per-source metadata to debug latency and failures.
- [x] Future source kinds have a clear registration point for their refresh task.

---

## Notes

This is separate from [OPP-098](./OPP-098-google-calendar-incremental-sync.md): incremental Calendar sync reduces the work per calendar source; this OPP reduces wall-clock latency by letting independent sources progress together.
