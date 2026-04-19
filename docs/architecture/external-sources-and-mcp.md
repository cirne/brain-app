# External Sources & MCP Strategy

## TL;DR

**MCP is a sync transport, not a query API.** ripmail's SQLite+FTS index is the query layer for all personal corpus data. When Brain needs to search Notion pages, the agent calls `ripmail search --source notion-*`, not an MCP tool. MCP (or equivalent provider REST APIs) are the mechanism used *during `ripmail refresh`* to pull remote data into the local index. The user experience: data is always local, searches are always fast, the network is only touched at sync time.

---

## Why local-first matters at query time

The agent-to-search loop happens in the middle of a conversation. Every millisecond of latency is felt. `ripmail search` over SQLite FTS5 returns in <50 ms regardless of whether the source was IMAP, Google Calendar, or Notion. An MCP round-trip to Notion's API during that same search would add 300–1500 ms, a network dependency, potential rate-limiting, and additional auth surface.

**Principle: no data source a user wants to search should require a live network call at query time.**

This is the same reasoning behind ripmail's IMAP-to-SQLite architecture, and it extends unchanged to remote cloud sources.

---

## The Source Taxonomy

[OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) introduced the `sources[]` model. This strategy adds a third category:

| Category | Examples | Key characteristic | Sync model |
|---|---|---|---|
| **Mail (IMAP/Gmail)** | Gmail, work IMAP | Append-only + expunge | Incremental — UID checkpoint, IDLE push |
| **Local files** | `~/Documents`, `~/dev` | Mutable by the local user | `mtime`/size change detection on crawl |
| **Remote mutable docs** | Notion, Linear, Slack | Created/updated/deleted by any actor at any time | Full CRUD sync with remote cursor |

The first two categories are already designed and partially implemented. This document addresses the third.

---

## The Mutable Document Problem

Email has a property that makes sync tractable: **messages are immutable once sent.** A message arrives, gets indexed, and the index entry is permanent (barring `EXPUNGE`/delete). Sync state is an append-log: "last UID seen" plus a set of deleted UIDs.

Notion pages, Linear issues, and similar remote documents break this model:

- A page can be **updated** — content changes; the local copy is now stale.
- A page can be **deleted** — the remote no longer exists; the local copy is orphaned.
- A page can be **moved or renamed** — stable remote id stays the same but metadata changes.
- **Any collaborator** (not just the Brain user) can trigger any of the above.

Sync therefore cannot be an append-only log. It requires:

1. **Change detection** — knowing a previously indexed document has new content.
2. **Update propagation** — reindexing stale content (ideally diff-aware).
3. **Delete propagation** — removing orphaned index rows when remote docs disappear.

These three requirements add meaningful complexity relative to mail sync. The design pivots on how each source *surfaces* changes, and how ripmail's sync pipeline handles them.

---

## Sync Strategies for Remote Mutable Sources

Not all APIs offer the same sync primitives. In order of preference:

### 1. Cursor-based incremental sync (preferred)

Modern APIs (Notion, Linear) provide a `next_cursor` or `sync_token` that returns everything changed since the last sync:

```
GET /databases/<id>/query?start_cursor=<last_cursor>
→ { results: [...changed pages...], next_cursor: "...", has_more: false }
```

The connector stores `last_cursor` in `RIPMAIL_HOME/<source-id>/sync-state.json`. On `ripmail refresh`:

1. Fetch changes since last cursor.
2. For each changed document: upsert into SQLite (insert or update FTS row).
3. For each delete tombstone in the response: remove row from index.
4. Advance the stored cursor.

This is efficient, network-light, and handles update+delete correctly with no full re-fetch.

### 2. Webhook-triggered sync (future / optional)

Sources that support push notifications (Notion webhooks, Linear webhooks) can notify brain-app directly. The host app receives the webhook, then triggers `ripmail refresh --source <id>`. This gives near-realtime freshness without polling.

Implementation complexity is higher: brain-app needs a public webhook endpoint, and the ripmail sync must be idempotent. Defer until a specific source makes real-time freshness worth the plumbing.

### 3. Full re-sync with change detection (fallback)

For sources with no cursor API: fetch all items, compare against the local index by `(source_id, remote_id, content_hash)`, upsert changed entries, and delete index entries whose remote IDs are no longer present. Expensive for large corpora; acceptable for small sources (a handful of Notion databases). Runs as a background `ripmail refresh` — not a blocking query-time operation.

---

## How This Fits the ripmail Sources Model

OPP-051's `sources[]` array uses `kind` as the discriminator. Remote mutable sources add new `kind` values (`notion`, `linear`, `slack`) alongside `imap`, `localDir`, `googleCalendar`. The shared CLI contract is unchanged:

```bash
# Setup
ripmail sources add --kind notion --token <api-key> [--databases <id1,id2>] [--label "Notion"]

# Sync
ripmail refresh --source notion-personal

# Query (always local)
ripmail search "project alpha" --source notion-personal

# Remove (purges all index rows for the source)
ripmail sources remove notion-personal
```

`ripmail read <remote-id>` returns the local index content — no live network call. For remote mutable sources, the "file" is the FTS row; for `localDir` sources, it reads live from disk. Same command, different resolution.

### Schema additions for mutable sources

Remote mutable document rows need fields that mail rows do not:

| Field | Purpose |
|---|---|
| `remote_id` | Provider's stable ID (Notion page UUID, Linear issue ID, etc.) |
| `remote_updated_at` | Staleness check without re-fetching body |
| `content_hash` | Fast-path: skip re-extraction if unchanged |
| `source_cursor` | Last successful sync cursor per source (stored in sync-state, not per-row) |

Soft-delete vs hard-delete on `EXPUNGE`/tombstone is an implementation decision; default to hard-delete (row gone from FTS, no orphan accumulation).

Exact schema is a clean-slate decision per [OPP-051 design norms](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md#design-constraint-read-this-first).

---

## MCP's Actual Role

Given the above, where does MCP fit?

**MCP is one possible implementation of the sync-time API client** — not the query layer, and not the sync controller.

When ripmail's Notion connector runs `refresh`, it needs to call the Notion API. Three implementation paths:

| Approach | Pros | Cons |
|---|---|---|
| **Native Rust HTTP client** (preferred) | Fast, no process overhead, consistent error handling, integrates naturally with ripmail's async runtime | Team writes and maintains the API client |
| **Official MCP server as subprocess** | High-quality official clients maintained by providers; free API modeling | Subprocess + JSON-RPC overhead; MCP was designed for agent tool-calling, not sync loops; poor fit for high-frequency background operations |
| **Third-party REST SDK** (Rust crate) | May exist for popular APIs | Quality and maintenance vary; another dependency |

**Recommended:** for initial connectors, write the API client in Rust directly. Notion, Linear, and Slack all have well-documented REST APIs. Treat official MCP servers as a *reference implementation* for understanding API shape and auth flows — not as the runtime sync client inside ripmail.

If brain-app later builds a full MCP client stack for agent tool extensibility (the OPP-021 / Settings data sources story), that infrastructure could also trigger syncs from the host side. But even then, the MCP call lands data in the ripmail index — it does not bypass the local-first query model.

---

## Responsibility Split: brain-app vs ripmail

| Responsibility | Owner |
|---|---|
| Settings UI for connecting a data source | brain-app (OPP-021) |
| OAuth / API key storage | brain-app drives flow; credentials stored under `RIPMAIL_HOME/<source-id>/` |
| Sync scheduling (startup, periodic, "sync now") | brain-app triggers `ripmail refresh` |
| Sync execution (API calls, write to SQLite) | ripmail binary |
| Query-time search and read | ripmail binary — `ripmail search`, `ripmail read` |
| Agent access | brain-app agent tools call ripmail; **no agent→MCP direct path at query time** |

The agent never calls a remote API directly during a conversation. It calls ripmail, which returns local results. Staleness is a sync freshness concern, not a query-path concern.

---

## Prioritization

**Connectors to build, in order:**

1. **Notion** — broadest audience overlap with Brain's non-developer target (founders, PMs, writers, students). Official REST API with cursor-based sync. Read-only first; update/delete propagation falls naturally out of the sync model above.

2. **Linear** — startup/PM demographic; excellent REST API + cursor sync. High value for "what's on my plate?" and "what shipped last week?"

3. **Slack** — richest work-context data outside email (who you talk to, what decisions get made). More complex: channels, permissions, message retention limits. Worth doing after Notion/Linear.

4. **Spotify** — enriches `me.md` / preferences; low sync frequency; easy OAuth. High "magic" return relative to implementation cost.

**Not via MCP, but fits the same pattern:**

- **Apple Notes** and **Apple Reminders** — local SQLite/CoreData on macOS. Read directly without REST or MCP, same pattern as iMessage (`chat.db`). Simpler than remote sources; no CRUD sync complexity.

---

## Open Questions

1. **Sync frequency defaults:** 15-minute polling for docs feels right; mail is near-realtime; calendar is somewhere between. Make it configurable per source kind with a sensible default.

2. **Webhook vs poll:** Which sources make real-time freshness worth the webhook infrastructure? Calendar events (OPP-053) are time-sensitive; Notion pages less so. Default to polling; add webhook paths source-by-source when users report needing fresher data.

3. **Write-back:** When should Brain write back to a source (create a Notion page, update a Linear issue)? Read-only sync first. Write-back only where the product benefit is clear and the source's data model supports clean round-trips (e.g. Linear issue status updates).

4. **Binary rename:** OPP-051 notes that "ripmail" may be too mail-specific as the binary becomes a universal personal corpus. The external source expansion reinforces the urgency of that rename decision — separate OPP, but noted here.

5. **Conflict model:** If Brain's agent writes back to a remote source (future) and the cursor sync subsequently pulls a server-side change, who wins? Default: remote wins (last-write-wins from the server's perspective). Brain never silently overwrites remote changes.

---

## Related

- [OPP-051: Unified Sources](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) — the `sources[]` model this extends
- [OPP-053: Calendar](../../ripmail/docs/opportunities/OPP-053-local-gateway-calendar-and-beyond.md) — first non-mail, non-file source; same patterns apply
- [integrations.md](./integrations.md) — trust boundaries, ripmail subprocess contract
- [OPP-021](../opportunities/OPP-021-user-settings-page.md) — Settings UI where users connect data sources
- [OPP-005: Source Ingestion](../opportunities/OPP-005-source-ingestion.md) — cross-tree alignment between brain-app and ripmail OPP-051
