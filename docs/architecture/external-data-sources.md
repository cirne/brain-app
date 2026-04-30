# External data sources (unified corpus)

## TL;DR

**Search is always local.** The agent queries **`ripmail search`** (SQLite FTS5). Remote APIs run only during **`ripmail refresh`** (sync), not during chat turns.

**MCP** (or any agent-facing remote tool protocol) is **not** the query layer for personal corpus data—it can inform **sync-time** API clients, but hits come from the local index.

**Implementation split:** **ripmail** owns sync execution, SQLite, FTS, and `search` / `read`. **brain-app** owns connect UX, OAuth/API-key flows, scheduling refresh, and agent tools that spawn ripmail.

Canonical corpus model: [ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) (`sources[]`, per-source `kind`).

---

## Why local-first at query time

Agent turns often issue several searches. **`ripmail search`** stays on the order of **&lt;50 ms**. A live Drive/Notion/Slack round-trip per search adds **hundreds of ms to seconds**, plus rate limits and failure modes.

**Principle:** no source the user expects to search should **require** a live network call at query time.

On-demand API calls are fine for **browsing** (e.g. folder picker, Hub navigation)—not as the primary search path.

---

## Source taxonomy

All kinds share one index and CLI surface (`--source <id>`); mail-only commands stay scoped to mail sources.

| Category | Examples | Characteristic | Sync model |
|---|---|---|---|
| **Mail** | Gmail, IMAP | Append-heavy + expunge | UID checkpoint, IDLE where available |
| **Local files** | `~/Documents`, granted dirs | Mutable on disk | Crawl: `mtime` / size |
| **Cloud file trees** | Google Drive ([OPP-045](../opportunities/OPP-045-google-drive.md)), similar providers later | Files live remotely; user selects trees | Incremental API sync + tokens/cursors |
| **Remote SaaS docs** | Notion, Linear, Slack | Mutable by anyone; CRUD | Cursor / webhook / periodic full rescan |

**Calendar** and other gateway-backed sources follow the same idea: data lands locally for fast agent access (see archived calendar notes linked from [integrations.md](./integrations.md) / ripmail docs).

---

## Unified agent tools (source parameter, not per vendor)

Avoid exploding tools (`google_drive_search`, `notion_search`, …). One shape, parameterized by **`source`** / **`sourceId`**:

| Tool | Role |
|---|---|
| `search_index(query, source?)` | FTS across the corpus; optional source filter |
| `list_files(folder?, source?)` | Browse trees (localDir, Drive, …) |
| `read_doc(id_or_path, source?)` | Resolve body: disk, cloud fetch + cache, or local indexed row (see below) |
| `manage_sources(op, …)` | Add/remove/configure sources by `kind` |
| `refresh_sources(source?)` | Trigger sync inside ripmail |

JSON hits carry **`sourceId`** / **`sourceKind`** so callers need no provider-specific routing.

---

## Indexing strategy by category

### Mail

Existing ripmail model: bodies and metadata in SQLite; **`ripmail read`** serves from local maildir/index without a network call.

### File-backed sources (localDir **and** cloud file trees)

Duplicating **full file text** in SQLite for every indexed path mirrors the corpus and balloons the DB.

**Decision:** **contentless FTS5** (`content=''`) — persist the **token index**, not the full original text. Store a **short excerpt** (~500 chars) for result snippets. Details: [ripmail ADR-030](../../ripmail/docs/ARCHITECTURE.md#adr-030-file-source-indexing--contentless-fts5-no-local-content-copy), [OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md).

**Read path:** **`ripmail read`** for files resolves to **on-disk path** (local) or **re-download via provider API** with a **short-TTL cache** under `RIPMAIL_HOME/<source-id>/cache/` (cloud). Sync still **fetches bytes long enough to tokenize** during refresh; the durable store is not “full text × every file.”

### File-source change detection and Markdown cache

**Applies to:** all non-mail sources — `localDir`, `googleDrive`, and any future cloud file kind.

**Principle:** never re-fetch or re-extract a file whose content has not changed since the last sync.

#### Change detection signals

| Source kind | Signal | Where stored |
|---|---|---|
| `localDir` | `mtime` + `size` from `fs::metadata` | `files.mtime`, `files.size` |
| Cloud sources (Drive, …) | Provider-reported hash + modified timestamp | `cloud_file_meta.content_hash`, `cloud_file_meta.remote_mtime` |

For **Google Drive**: `files.list` and `changes` responses include `md5Checksum` (binary files) and `modifiedTime`. For exported Google Docs/Sheets/Slides there is no `md5Checksum` — compute SHA256 of the exported bytes after download.

On each `refresh`, compare the stored signal against the API/stat response before fetching content. Skip extraction and `document_index` upsert entirely if both signals match.

#### Markdown cache

Extracted/exported plain text is stored under `RIPMAIL_HOME/<source-id>/cache/<remote_id>.md` (cloud) or served live from disk (local). For cloud sources:

- **Write**: after fetching and extracting, write cache file and store its path in `cloud_file_meta.cached_md_path`.
- **Validate**: on `ripmail read <remote-id>`, check `cloud_file_meta.content_hash` + `remote_mtime` against a lightweight Drive metadata fetch (fields: `id,md5Checksum,modifiedTime` only). If unchanged, serve from cache. If changed, re-download, re-extract, overwrite cache, update `cloud_file_meta`.
- **Invalidate**: when a drive change event marks a file deleted or trashed, remove the `document_index` row, `cloud_file_meta` row, and cache file.

#### Schema

```sql
-- Per-file change detection + cache pointer for cloud sources
CREATE TABLE IF NOT EXISTS cloud_file_meta (
  source_id      TEXT NOT NULL,
  remote_id      TEXT NOT NULL,   -- stable provider ID (Drive file ID)
  content_hash   TEXT,            -- md5Checksum from Drive (binary) or SHA256 of exported text
  remote_mtime   TEXT,            -- provider modifiedTime (ISO)
  cached_md_path TEXT,            -- relative path under RIPMAIL_HOME for cached extracted text
  PRIMARY KEY (source_id, remote_id)
);
```

**localDir** uses the **`files`** table (`mtime`, `size`) with the same principle: unchanged files skip re-read and `document_index` upsert; paths that disappear from disk are deleted from the index.

#### General pattern for future connectors

Every cloud file source added after Drive must follow the same contract:
1. Request `content_hash` (or equivalent) and `modified_at` from the provider API
2. Check `cloud_file_meta` before fetching content — skip unchanged files
3. Write extracted Markdown to the cache and record `cached_md_path`
4. On deletion, purge `document_index` + `cloud_file_meta` + cache file

This keeps `ripmail refresh` fast on subsequent runs regardless of corpus size.

---

### Remote mutable SaaS documents (Notion-style)

Sync must handle **updates and deletes**, not only append:

1. Change detection  
2. Reindex when content changes  
3. Remove tombstoned / deleted remote IDs locally  

Prefer **cursor- or token-based incremental APIs**. Fallback: full enumeration + content-hash compare (background refresh only).

Extra row metadata (conceptual): `remote_id`, `remote_updated_at`, `content_hash`; cursor in `RIPMAIL_HOME/<source-id>/sync-state.json`.

**Read path:** **`ripmail read`** typically returns **materialized content from the index** for these rows (no query-time provider hop)—exact schema is clean-slate per OPP-051.

---

## MCP’s role

**MCP is optional sync-transport / reference**, not the query API.

Preferred connector implementation: **native HTTP client in ripmail** for refresh loops (predictable errors, no subprocess JSON-RPC). Official MCP servers can help explore API shapes; they are a poor fit as the inner loop of high-frequency sync.

If brain-app gains MCP-driven extensibility later, sync results must still **land in ripmail** before search—not bypass the index.

---

## brain-app vs ripmail

| Responsibility | Owner |
|---|---|
| Settings / connect UI | brain-app ([OPP-021](../opportunities/OPP-021-user-settings-page.md)) |
| OAuth / secrets placement | brain-app drives flow → **`RIPMAIL_HOME/<source-id>/`** |
| When to sync | brain-app triggers **`ripmail refresh`** |
| API calls during sync, SQLite/FTS | **ripmail** binary |
| **`ripmail search` / `ripmail read`** | **ripmail** |
| Agent | brain-app tools → ripmail only at query time |

---

## Product sequencing (high level)

- **Cloud files:** **Google Drive** first — [OPP-045](../opportunities/OPP-045-google-drive.md). Additional file hosts reuse the same `kind` + tooling pattern.
- **SaaS docs:** **Notion → Linear → Slack** (read-only sync first; write-back only where justified)—breadth vs complexity tradeoff.
- **Low-friction local-adjacent:** Apple Notes / Reminders (macOS stores)—same local-query pattern, simpler sync story.

Optional breadth accelerator (hosted connector layer): [OPP-040](../opportunities/OPP-040-one-formerly-pica-integration-layer-ripmail-sources.md).

---

## Open questions

1. **Polling defaults** — per-`kind` intervals (mail near-realtime, docs ~minutes, calendar event-sensitive windows).
2. **Webhooks** — which sources justify public endpoints + push vs poll-only.
3. **Write-back** — deferred until read-only sync is stable.
4. **Binary rename** — “ripmail” as universal corpus carrier ([OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)).
5. **Conflict policy** — if write-back exists later: **remote wins** unless explicitly designed otherwise.

---

## Related

- [integrations.md](./integrations.md) — subprocess boundary, `/api/search`, trust notes  
- [OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) — `sources[]` target architecture  
- [OPP-045](../opportunities/OPP-045-google-drive.md) — Google Drive product milestone  
- [packaging-and-distribution.md](../packaging-and-distribution.md) — OAuth / cloud-drive constraints  

**Supersedes:** earlier standalone write-up `external-sources-and-mcp.md` (merged into this document).
