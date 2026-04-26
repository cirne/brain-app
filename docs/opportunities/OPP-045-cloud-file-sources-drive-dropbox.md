# OPP-045: Cloud file sources (Google Drive, Dropbox)

**Status:** Open.

**Created:** 2026-04-22. **Updated:** 2026-04-26 (architecture decisions from google-drive branch spike).

**Related:** [ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) (unified `sources` model; `localDir` for on-disk files; **contentless FTS5 schema for files**), [OPP-040](OPP-040-one-formerly-pica-integration-layer-ripmail-sources.md) (One / Pica as optional connector accelerator), [OPP-021](OPP-021-user-settings-page.md) (Hub data-sources shell), [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) / [shipped OPP-019](OPP-019-gmail-first-class-brain.md) (Google OAuth surface area for additional scopes), [external-sources-and-mcp.md](../architecture/external-sources-and-mcp.md) (local-first indexing strategy, MCP as sync transport).

**Tags:** desktop, ingests

---

## Summary

Bring **user-chosen cloud folders and files** into the same "search and ground on my documents" story as the **desktop app's** path-granted local directories: explicit consent, then **sync or incremental fetch** into the **unified personal corpus** (ripmail's evolving `sources[]` + index), not ad hoc uploads per chat turn.

**Google Drive** is the lead candidate (many users already store docs there; **Google** OAuth and trust patterns overlap existing Gmail work). **Dropbox** is a strong **short-term** second target: mature Files API, familiar OAuth, similar **list + download + version** semantics to Drive—worth implementing **in the same connector shape** (one `kind` or two sibling kinds sharing helpers) so we do not design twice. **Box** is a plausible third.

---

## Problem

- **Local-only** indexing (`localDir` / Tauri folder picks) does not see files that live **only in cloud** (no Desktop sync, different machine, or user expectation of "read my Drive" without mirroring the whole tree to disk).
- **Per-file upload in chat** does not scale to "treat this Drive/Dropbox tree like my `~/Documents` grant."
- [packaging-and-distribution.md](../packaging-and-distribution.md) already flags **cloud-drive OAuth** or **sync client** as the honest alternatives to "automatic indexing of arbitrary paths" for non-local data.

---

## Architecture decisions (settled 2026-04-26)

### 1. Local index, not on-demand API calls

Cloud file sources **must** go through ripmail's local SQLite FTS5 index. The alternative — calling Drive/Dropbox APIs live during agent search — would cost 1–2 s per call vs <50 ms for a local index query. Agent turns often involve 3–5 search calls; a 5–10 s wall-time penalty per turn is unacceptable.

This matches the principle stated in [external-sources-and-mcp.md](../architecture/external-sources-and-mcp.md): **no data source a user wants to search should require a live network call at query time.**

On-demand API calls remain useful for **browsing/navigation** (folder tree UX in Hub) but are not the primary agent search path.

### 2. Unified agent tool API — parameterized by source, not per-provider

The agent toolset must **not** grow per-provider tools (`google_drive_search`, `dropbox_search`, `box_search`, …). That leads to combinatorial explosion and forces the agent to know which tool to pick before it knows which source has the relevant file.

Instead: one set of source-agnostic tools, parameterized by `source`:

| Tool | Role |
|---|---|
| `search_index(query, source?)` | Unified FTS search across all indexed sources; `source` narrows to one |
| `list_files(folder?, source?)` | Browse a folder tree; works across localDir, Drive, Dropbox via the same call |
| `read_doc(id_or_path, source?)` | Read a single item; resolves local path OR cloud file ID by source kind |
| `manage_sources(op, ...)` | Add/edit/remove sources; `op=add` dispatches by kind (`localDir`, `googleDrive`, `dropbox`) |
| `refresh_sources(source?)` | Trigger sync; kind-specific sync logic runs inside ripmail |

The JSON result from `search_index` carries `sourceId` and `sourceKind` so the agent knows what it got without routing logic. `read_doc` resolves the ID against the correct backend based on source metadata.

This is the **only** correct long-term shape. New fileshare integrations (Box, SharePoint, iCloud Drive) add a new `kind` in ripmail — no new tool names.

**The google-drive branch made the mistake** of adding `google_drive_list` and `google_drive_search` as separate tool names. These should be `list_files(source=...)` and subsumed into `search_index`.

### 3. Contentless FTS5 for file sources — no local content copy

Storing full file text in SQLite (as `files.body_text` and `document_index.body`) would cause the DB to grow proportionally with every indexed Drive folder — effectively mirroring cloud storage locally. This is not acceptable.

Instead, file sources use **contentless FTS5** (`content=''`): SQLite stores only the token/position index, not the original text. Storage is roughly 20–40% of raw text (the FTS token index) rather than 200%+ (two full copies + FTS index). See [ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) and [ADR-030](../../ripmail/docs/ARCHITECTURE.md#adr-030-file-source-indexing--contentless-fts5-no-local-content-copy) for the schema detail.

At read time, `ripmail read` goes to disk (local files) or re-downloads via cloud API (Drive/Dropbox) with a short-TTL cache under `RIPMAIL_HOME/<source-id>/cache/`. Agent search still returns in <50 ms; content retrieval is on-demand only when the agent explicitly calls `read_doc`.

A small `excerpt` (~500 chars) is stored in the `files` table for search result display — not the full body.

---

## Proposed direction

1. **Ripmail `kind` additions** — `googleDrive`, `dropbox` (and later `box`) under [OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md); credentials under `RIPMAIL_HOME/<source-id>/`; `refresh` fetches metadata + file content for FTS tokenization using the contentless schema ([ADR-030](../../ripmail/docs/ARCHITECTURE.md#adr-030-file-source-indexing--contentless-fts5-no-local-content-copy)); hits carry `sourceId`/`sourceKind` in search JSON.
2. **OAuth in brain-app** — Connect flows, scope consent, and token storage follow the same Hono + vault patterns as mail where applicable; **additional Google scopes** (Drive) must be weighed against [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) verification and consent-screen limits.
3. **Hub** — "Data sources" lists connected cloud providers alongside mail and local dirs ([OPP-021](OPP-021-user-settings-page.md) scaffolding).
4. **Short term** — Sequencing can favor **Dropbox and Drive in parallel** as engineering capacity allows, but **treat them as one product bet** (cloud file sources), not two unrelated projects.

**Optional accelerator:** [OPP-040](OPP-040-one-formerly-pica-integration-layer-ripmail-sources.md) if we prefer breadth via a hosted integration layer; tradeoffs (privacy, vendor, cost) apply.

---

## google-drive branch learnings

A spike was built on the `google-drive` branch (single commit: `59072ac`). Key learnings:

- **Architecture was correct** — ripmail `kind=googleDrive`, unified `sources` config, brain-app OAuth wiring, and `manage_sources` tool extension are the right shape.
- **Two implementation bugs blocked completion** (tracked as [`BUG-061`](../../ripmail/docs/bugs/BUG-061-google-drive-sync-hang-search-empty.md) on the branch):
  - **Sync hang** — likely a blocking HTTP call (Drive export/download) inside a synchronous Rust context. Fixable: async or offload to a thread.
  - **Search returns empty** — probable FTS table or `source_id` join mismatch for file-kind rows. Fixable: targeted SQL/schema debugging.
- **Wrong tool design** — the branch added `google_drive_list` and `google_drive_search` as separate tool names, contrary to decision #2 above.
- **Content storage** — the branch stored full extracted text in both `files.body_text` and `document_index.body`; the contentless FTS5 approach (decision #3) resolves the DB-growth concern.

The branch is preserved for reference. The bugs are implementation issues, not architectural dead ends.

---

## Non-goals (for this OPP's first slice)

- Full **two-way** sync or editing files in the cloud from Braintunnel (read + index for grounding is the default first milestone).
- Replacing the **local** `localDir` path; cloud complements it.
- **Vector / embedding search** as a replacement for FTS5 — deferred (adds model dependency and comparable DB size; agent multi-query compensates for FTS recall gaps at current scale).
- **Ripmail** [OPP-045 (iMessage / unified messaging)](../../ripmail/docs/opportunities/OPP-045-imessage-and-unified-messaging-index.md) — different `OPP-045` id in the **ripmail** tree; only the number collides by convention across namespaces.

---

## Open questions

- Incremental sync: **change tokens** (Drive) vs **cursor/list** (Dropbox) + conflict policy for re-auth.
- **Size / quota** caps: max file bytes, folder depth, and whether to index **shared-with-me** vs **My Drive** only.
- **Hosted vs desktop**: OAuth redirect and token storage when brain-app runs in cloud vs Tauri (reuse patterns from OPP-019/041 as applicable).
- **Cache TTL** for cloud file content under `RIPMAIL_HOME/<source-id>/cache/`: how long to serve cached bytes before re-downloading on `read_doc`.
