# Calendar read/write path (TypeScript ripmail)

**Status:** **Implemented on `main`** — calendar indexing and agent-facing reads/writes go through **`src/server/ripmail/`** (in-process `better-sqlite3` on the tenant **`ripmail/`** SQLite). There is **no** `ripmail calendar …` subprocess on the hot path.

---

## Current shape

- **Reads:** `GET /api/calendar`, agent **`get_calendar_events`**, and related helpers use **`calendarRange`** / **`calendarListCalendars`** from **`@server/ripmail`**, with an in-memory cache layer in [`calendarRipmail.ts`](../../src/server/lib/calendar/calendarRipmail.ts) / [`calendarCache.ts`](../../src/server/lib/calendar/calendarCache.ts).
- **Writes (agent tools):** create/update/cancel/delete call **`ripmailCalendarCreateEvent`** and siblings from **`@server/ripmail`** — local rows first; Google Calendar API work lives in the **sync** layer (`googleapis` inside **`src/server/ripmail/sync/`**), not in a separate Rust CLI.
- **Refresh:** background / explicit refresh uses **`ripmailRefresh`** / **`runRipmailRefreshInBackground`** (same TS module), not a detached `ripmail refresh` binary.

---

## Historical note (pre–TS port)

Earlier design docs discussed a **subprocess** calendar CLI (JSON over stdout) vs **direct `googleapis`** from Node for writes. That split applied when mail lived in the **Rust** `ripmail` binary. The TypeScript port **collapses** the “two processes” problem for calendar: everything above runs in the **same Node process** as Hono and the agent.

---

## Follow-on

- **Product / UX gaps** (e.g. exposing `calendar_ids` edits only via raw config) stay tracked under opportunities like **[OPP-031](../opportunities/archive/OPP-031-preference-memory-tools.md)** — not a subprocess vs in-process tradeoff anymore.

---

*Back: [README.md](./README.md) · [data-and-sync.md](./data-and-sync.md)*
