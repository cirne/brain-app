# Calendar write path: subprocess vs direct API

**Status:** Active design decision — write operations (create/update/delete) are being added to the calendar surface as of April 2026.

---

## Background

The calendar **read** path goes: Node → `ripmail calendar range` subprocess → JSON stdout → parse → in-memory cache → agent / UI. This works acceptably because the cache absorbs most subprocess overhead, and reads are idempotent.

The calendar **write** path (create event, update event, delete/cancel event) is a different shape. Writes need synchronous confirmation, clean error propagation, and the ability to surface partial failures. Going through a subprocess for mutations introduces friction at each of these.

---

## Subprocess write path: current shape

```
Agent tool call
  → execRipmailAsync('calendar create-event …')
  → wait for process exit
  → parse stdout/stderr
  → return success/error to agent
```

Problems:
- **No streaming progress** — the agent sees nothing until the subprocess exits.
- **Error surface is lossy** — ripmail exit codes and stderr must be parsed; structured error types from the Google API are flattened to strings.
- **Compound event ID** (`sourceId:uid`) is a leaky abstraction that threads through the Rust CLI, the Node tool, and the client UI — every layer must understand the format.
- **Hard to test** — requires the ripmail binary; unit tests for the Node tool layer cannot mock at the API level.
- **Invalidation coupling** — after a write, the cache must be invalidated and a `ripmail refresh` triggered to re-index; the write confirmation and the eventual read consistency are decoupled by a subprocess boundary.

---

## Alternative: direct Google Calendar API from Node for writes

Brain already holds Google OAuth tokens (same tokens used for Gmail). The Google Calendar REST API is well-documented and has a maintained Node client.

A direct-write path:

```
Agent tool call
  → googleCalendarClient.events.insert(…)   // direct HTTPS, awaitable
  → confirmed response with event id
  → optimistic cache update or invalidate + background ripmail refresh
```

Benefits:
- **Synchronous confirmation** with structured error types.
- **Simpler event IDs** — Google event resource IDs directly, no `sourceId:` prefix needed for write operations.
- **Testable** — mock `googleapis` client in unit tests without a binary.
- **Cleaner agent tool** — success/failure is the HTTP response, not process exit + stdout parse.

ripmail remains the **read and index source** — it owns the SQLite calendar index, handles ICS sources and Apple Calendar, and drives the background sync. Only the Google Calendar **write** operations (create/update/delete) move to the direct API path.

---

## Decision criteria

Use the **direct API path** if:
- The operation mutates Google Calendar (create, update, delete, RSVP).
- You need synchronous confirmation before returning a tool result.

Keep the **subprocess path** for:
- All calendar reads (ripmail cache is the source of truth for queries).
- Non-Google sources (ICS files, Apple Calendar — no direct write API via Node).
- Background refresh (`ripmail refresh`).

---

## Migration path

1. Add `googleapis` (or a minimal fetch wrapper) for Google Calendar writes in Node.
2. Refactor `calendarTools.ts` write operations to use the direct client.
3. After a write, fire a background `ripmail refresh --source <sourceId>` to re-index (non-blocking, same pattern as current refresh).
4. Remove write-operation CLI flags from the ripmail calendar command surface, or keep them for CLI use only.

---

*Back: [README.md](./README.md) · [data-and-sync.md](./data-and-sync.md)*
