# External data sources (unified corpus)

## TL;DR

**Discovery is local.** The agent uses **`ripmail search`** (SQLite FTS5) to find candidates. **Search must not require a live network call.**

**Materialization depends on source kind.** **Mail** keeps bodies locally for offline read. **Remote documents** (cloud file trees such as Google Drive, and SaaS pages such as Notion) share one contract: **metadata + bounded extracted text** in the index for FTS; **authoritative body on read** via provider fetch with an optional **short TTL cache** (target: on the order of **~10 minutes**) so reads stay fresh without hammering APIs.

**MCP** (or similar) is **not** the primary query layer for the personal corpus—it may inform connector code or experiments, but **hits come from the local index** and **connector reads** use predictable HTTP/API clients in-process where possible.

**Implementation split:** **`@server/ripmail`** (TypeScript, in-process SQLite on each tenant’s **`ripmail/`** tree) owns sync execution, SQLite, FTS, and search/read pipelines. **brain-app** owns connect UX, OAuth/API-key flows, scheduling refresh, and agent tools that invoke ripmail.

Canonical corpus model: [archived OPP-087](../opportunities/archive/OPP-087-unified-sources-mail-local-files-future-connectors.md) (`sources[]`, per-source `kind`).

---

## Why local-first at query time

Agent turns often issue several searches. **`ripmail search`** stays on the order of **&lt;50 ms**. A live Drive/Notion/Slack round-trip **per search** adds **hundreds of ms to seconds**, plus rate limits and failure modes.

**Principle:** anything the user expects to **search** across should be **indexed locally** (at least through the bounded text we sync).

On-demand API calls are appropriate for **browsing** (folder picker, Hub navigation), **connector refresh**, and **explicit document read** after the agent picks a hit—not as the inner loop of every search.

---

## Indexed unit, catalog, and materialization

These terms apply across connectors:

| Concept | Meaning |
|--------|---------|
| **Indexed unit** | The granularity of one corpus row (e.g. mail message, Drive file, Notion page, chat message). |
| **Catalog fields** | Stable remote id, titles/names, containers/parents, timestamps, MIME/kind, participants/channel where relevant, sync cursor/version/hash—everything needed to filter, display snippets, and **fetch** the full body later. |
| **Search payload** | Text passed to FTS—**bounded** (max chars/tokens per unit, policy per `kind`) so sync stays predictable and the DB does not mirror the entire remote corpus. |
| **Authoritative read** | Full body at agent request time: **local disk**, **local mail store**, or **provider API** (+ TTL cache for remote), depending on kind. |

**Rule of thumb:** the index answers *“what exists and what might match?”* Full content for **remote** kinds is **not** the long-lived source of truth in SQLite—FTS uses a **deliberately capped** text slice plus metadata; **read** refreshes from the provider when needed (within TTL cache).

---

## Source taxonomy

All kinds share one index surface and consistent agent tools (`search_index`, `read_doc`, …); mail-only commands stay scoped to mail sources.

| Category | Examples | Indexed unit | Typical sync |
|----------|-----------|--------------|--------------|
| **Mail** | Gmail, IMAP | Message | UID checkpoint, IDLE where available |
| **Local files** | `localDir`, granted dirs | File path | Crawl: `mtime` / size |
| **Remote documents — cloud files** | Google Drive ([archived OPP-045](../opportunities/archive/OPP-045-google-drive.md)), similar hosts | File / exported doc | Incremental API sync + cursors/hashes |
| **Remote documents — SaaS** | Notion, Linear, Slack (scoped), … | Page / record / message (per connector contract) | Cursor / webhook / periodic rescan |

**Remote documents** (cloud file tree **and** SaaS) share the **same architectural contract** below; only extraction and API details differ.

**Calendar** and other gateway-backed sources: data lands locally for fast agent access (see [integrations.md](./integrations.md) / calendar docs).

**Messaging** (e.g. Apple Messages via `chat.db`): distinct trust boundary and tooling today—see [integrations.md](./integrations.md); deeper index direction in [archived OPP-037](../opportunities/archive/OPP-037-messages-index-and-unified-people.md), [archived OPP-083](../opportunities/archive/OPP-083-imessage-and-unified-messaging-index.md). Chat favors **short bodies** and often **local** canonical stores; materialization policy may inline text in SQLite when it matches product constraints—still separate from **remote document** reads.

---

## Unified agent tools (source parameter, not per vendor)

Avoid exploding tools (`google_drive_search`, `notion_search`, …). One shape, parameterized by **`source`** / **`sourceId`**:

| Tool | Role |
|------|------|
| `search_index(query, source?)` | FTS across the corpus; optional source filter |
| `list_files(folder?, source?)` | Browse trees (`localDir`, Drive, …) |
| `read_doc(id_or_path, source?)` | Resolve **authoritative** body: local disk, local mail row, or **remote fetch + TTL cache** (see policies below) |
| `manage_sources(op, …)` | Add/remove/configure sources by `kind` |
| `refresh_sources(source?)` | Trigger sync / re-index slice |

JSON hits carry **`sourceId`** / **`sourceKind`** so callers need no provider-specific routing.

---

## Materialization policies by category

### Mail

- **Indexed unit:** message.
- **Local store:** bodies and metadata in SQLite / maildir-aligned layout; **`ripmail read`** serves from the local index **without** a network call for normal mail paths.
- **Search:** full mailbox FTS semantics as implemented in `@server/ripmail` (not bounded in the same way as remote docs; product is “search my mail,” not “search previews only”).

### Local directory files (`localDir`)

- **Indexed unit:** file path.
- **Search payload:** **contentless FTS5** (`content=''`) — persist **tokens**, not a full duplicate of file text in SQLite; store a **short excerpt** (~500 chars) for snippets. See ADR-030 on the Rust ripmail snapshot tag ([ripmail-rust-snapshot.md](./ripmail-rust-snapshot.md)), [archived OPP-087](../opportunities/archive/OPP-087-unified-sources-mail-local-files-future-connectors.md).
- **Authoritative read:** **live filesystem read** (plus extraction for PDFs/office formats as implemented). No cloud fetch.

### Remote documents (cloud file **`googleDrive`** and SaaS **`notion`-style kinds`)

**Same plan for both:**

1. **Catalog + bounded search text**  
   Persist metadata and enough **extracted/plain text** to drive FTS—**capped** per document (max chars/tokens, tuned per `kind`) so search quality is strong for typical queries without storing the entire remote corpus.

2. **Contentless FTS pattern**  
   Use FTS5 **without** storing full original text in SQLite—**token index + excerpt/snippet fields** for display—consistent with file-backed indexing ([archived OPP-087](../opportunities/archive/OPP-087-unified-sources-mail-local-files-future-connectors.md)).

3. **Authoritative read**  
   When the agent selects a hit, **fetch current body from the provider** (HTTP export, blocks API, etc.). Optionally satisfy from a **short TTL cache** (~10 minutes by default) keyed by remote id + revision/hash to balance freshness and rate limits.

4. **Sync responsibilities**  
   Handle **updates and deletes**, not only append: change detection (hash / `modifiedTime` / provider revision), **reindex bounded text** when content changes, remove tombstoned remote ids locally. Prefer **cursor- or token-based incremental APIs**; fallback: enumeration + hash compare during **refresh** only.

5. **Row metadata (conceptual)**  
   `remote_id`, `remote_updated_at`, `content_hash` (or provider equivalent), excerpt; cursor in `ripmail/<source-id>/sync-state.json` (paths per [`brain-layout.json`](../../shared/brain-layout.json)).

**Implementation note:** persistent files under `ripmail/<source-id>/cache/` may still exist as an **optimization** (e.g. avoid re-downloading large exports within TTL, or survive process restarts). The **product contract** remains: **FTS from bounded local slice; full body from fetch-on-read with TTL semantics**, not “SQLite is the document server.”

---

## Change detection and skipping redundant sync work

**Applies to:** `localDir` and all **remote document** kinds.

**Principle:** do not re-fetch or re-extract content solely to refresh FTS when the provider says nothing changed.

### Signals

| Source kind | Signal | Typical storage |
|-------------|--------|-----------------|
| `localDir` | `mtime` + `size` | `files.mtime`, `files.size` |
| Remote documents | Provider hash + modified timestamp (or revision id) | e.g. `cloud_file_meta.content_hash`, `cloud_file_meta.remote_mtime` |

For **Google Drive**, `files.list` / `changes` expose `md5Checksum` (binary) and `modifiedTime`; native Google Docs may require hashing exported bytes. Compare on each `refresh` before downloading full content for re-indexing.

### Deletes

When the remote marks a unit deleted or out of scope, remove **FTS rows**, **catalog rows**, and **cache entries** for that id.

### Schema sketch (cloud-style meta)

Per-remote-id metadata remains useful for change detection and cache pointers (exact columns evolve with implementation):

```sql
CREATE TABLE IF NOT EXISTS cloud_file_meta (
  source_id      TEXT NOT NULL,
  remote_id      TEXT NOT NULL,
  content_hash   TEXT,
  remote_mtime   TEXT,
  cached_body_path TEXT,  -- optional; TTL + invalidation policy applies
  PRIMARY KEY (source_id, remote_id)
);
```

**localDir** uses the same “skip if unchanged” idea via filesystem metadata before re-reading bytes into the bounded FTS pipeline.

---

## MCP’s role

**MCP is optional sync-transport / exploration**, not the query API.

Preferred connector implementation: **HTTP client inside `src/server/ripmail/sync/`** (or shared lib) for refresh and read paths—predictable errors, no extra process on hot paths. MCP servers can help prototype API shapes; they are a poor fit as the inner loop of high-frequency sync.

If brain-app gains MCP-driven extensibility later, **search hits must still come from the local FTS index**; **read** may delegate to a connector that happens to speak MCP, but results should still respect **TTL / tenancy / secrets** policy—not ad hoc bypass of the corpus contract.

---

## brain-app vs `@server/ripmail`

| Responsibility | Owner |
|----------------|--------|
| Settings / connect UI | brain-app ([OPP-021](../opportunities/OPP-021-user-settings-page.md)) |
| OAuth / secrets placement | brain-app drives flow → tenant **`ripmail/<source-id>/`** |
| When to sync | brain-app triggers refresh (`POST /api/…`, agent tools, onboarding, …) |
| API calls during sync, SQLite/FTS, search/read implementation | **`@server/ripmail`** (TypeScript; in-process on `main`) |
| Agent | brain-app tools → ripmail search/read |

---

## Product sequencing (high level)

- **Remote documents — cloud:** Google Drive first ([archived OPP-045](../opportunities/archive/OPP-045-google-drive.md)); additional hosts reuse the same **remote document** contract.
- **Remote documents — SaaS:** Notion → Linear → Slack (read-only sync first; explicit **scope** knobs for high-volume sources)—same bounded FTS + fetch-on-read pattern.
- **Low-friction local-adjacent:** Apple Notes / Reminders (macOS stores)—often closer to **`localDir`** / local crawl than SaaS.

Optional breadth accelerator (hosted connector layer): [OPP-040](../opportunities/OPP-040-one-formerly-pica-integration-layer-ripmail-sources.md).

---

## Open questions

1. **Bounded FTS limits** — exact caps per `kind` (chars vs tokens; head-only vs future summarization).
2. **TTL defaults** — global vs per-provider read cache duration; interaction with conditional GET / metadata-only checks.
3. **Polling defaults** — per-`kind` refresh intervals (mail near-realtime, remote docs ~minutes).
4. **Webhooks** — which sources justify push vs poll-only.
5. **Write-back** — deferred until read-only sync is stable.
6. **Binary rename** — “ripmail” as universal corpus carrier ([archived OPP-087](../opportunities/archive/OPP-087-unified-sources-mail-local-files-future-connectors.md)).
7. **Conflict policy** — if write-back exists later: **remote wins** unless explicitly designed otherwise.

---

## Related

- [integrations.md](./integrations.md) — `@server/ripmail`, `/api/search`, trust boundaries (mail vs Messages).
- [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md) — wiki tools vs indexed corpus reads.
- [archived OPP-087](../opportunities/archive/OPP-087-unified-sources-mail-local-files-future-connectors.md) — `sources[]` target architecture.
- [archived OPP-045](../opportunities/archive/OPP-045-google-drive.md) — Google Drive milestone.
- [packaging-and-distribution.md](./packaging-and-distribution.md) — OAuth / cloud-drive constraints.

**Supersedes:** earlier standalone write-up `external-sources-and-mcp.md` (merged into this document).
