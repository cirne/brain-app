# OPP-076: Search hit preview rows — metadata, full vs slim JSON

**Status:** Open (planning).

**Created:** 2026-05-01.

**Tags:** ui, ripmail, agent-chat, google-drive

---

## Summary

Chat tool previews for **`search_index`** (`MailSearchHitsPreviewCard`, `MailSearchResultsPanel`) show a generic **“Indexed file”** subtitle for Drive/local hits because those rows have **no `from`**. Ripmail already emits richer fields in **full** search JSON (**`date`**, **`sourceKind`**, **`snippet`**, etc.), but the web client **does not parse `date`** and does **not map `sourceKind`** into human copy.

Product ask: show **location** — the file path **relative to the indexed corpus root** (for **localDir**, the configured folder; for **Google Drive**, the path under the user’s **synced folder roots**, not “My Drive” globally). Today only **local** hits have that path **in the DB** at search time; **Drive** indexes **filename only** unless we extend ripmail storage/sync.

**Slim** JSON rows **omit `sourceKind` and `snippet`** (and would omit any new path field unless we add it), so the UI must **tier behavior**: rich secondary lines when data exists, **date-first** when only slim fields arrive, and optional **tool-arg context** (`search_index` `source`) when ripmail is silent.

---

## Background: ripmail row shapes

Ripmail `search --json` builds each row from `SearchResult` ([`ripmail/src/search/types.rs`](../../ripmail/src/search/types.rs)).

| Shape | When | Typical fields in each `results[]` row |
| ----- | ---- | ---------------------------------------- |
| **Full** | `--result-format full`, or **`auto`** with result count **≤ `SEARCH_AUTO_SLIM_THRESHOLD`** (50) | `messageId`, `threadId`, `sourceId` (if set), `sourceKind` (if set), `fromAddress`, `fromName`, `subject`, **`date`**, **`snippet`**, `bodyPreview`, `rank`, **optional `indexedRelPath`** (planned; see below) |
| **Slim** | `--result-format slim`, or **`auto`** with **> 50** results | `messageId`, `subject`, **`date`**, optional **`fromName`** only ([`search_result_to_slim_json_row`](../../ripmail/src/search/json_format.rs)) — **no** `sourceKind`, **no** `snippet`, **no** `fromAddress`, **no** `indexedRelPath` unless we deliberately extend slim |

**Implication:** any UI that depends on **`sourceKind`**, **`snippet`**, or **path** **degrades automatically** on large hit lists unless ripmail changes slim shape or the agent forces **`full`** for small `limit` calls.

---

## Indexed location (`indexedRelPath`)

**Meaning:** Path of the hit **relative to the source root** the user configured (local indexed folder or Drive sync roots), using **`/`** segments, e.g. `Work/Invoices/2025/Q1.pdf`. Not an absolute filesystem path; not the raw Drive `ext_id`.

| Source kind | Data today | Notes |
| ----------- | ---------- | ----- |
| **`localDir`** (`files` + `document_index` `kind = 'file'`) | **`files.rel_path`** is already loaded in [`regex_search_files`](../../ripmail/src/search/engine.rs) (SQL selects `f.rel_path`). It is **not** yet copied into `SearchResult` / JSON. | **Low effort:** add optional JSON `indexedRelPath` (camelCase) on full rows, set from `rel_path`. |
| **`googleDrive`** | `document_index` stores **`title`** (filename) and **`ext_id`** (file id); **`cloud_file_meta`** has no parent path. | **Higher effort:** during Drive sync/changes, resolve **`parents`** within **allowed roots** and persist e.g. `display_rel_path` (new column on `document_index` or `cloud_file_meta`), then surface in search rows. Until then, UI can show **filename only** in `subject` and omit path (or show “Google Drive” without a folder trail). |

**UI:** Prefer **one** muted line combining **connector label · relative path** (truncate middle with ellipsis if long), or **path** directly under the subject when the connector is obvious from context. Avoid duplicating **filename** if `subject` is already the file name.

**Slim:** Default **omit** `indexedRelPath` from slim to keep payloads small; if we later add it, **cap length** (e.g. 80–96 chars) for preview list UIs only.

---

## Current state (brain-app)

- **Parser:** [`parseSearchIndexJsonResult`](../../src/client/lib/tools/matchPreview.ts) maps `messageId`, `subject`, `fromName`/`fromAddress`, `snippet`, `sourceKind` → `MailSearchHitPreview`. **`date` is ignored.**
- **Card:** [`MailSearchHitsPreviewCard.svelte`](../../src/client/components/cards/MailSearchHitsPreviewCard.svelte) uses `from` for mail; for indexed hits falls back to the literal **“Indexed file”**; shows `snippet` when non-empty.

---

## Recommendations by row “size” (full vs slim)

Treat **“what we can show”** as a **capability matrix** driven by **parsed fields**, not layout breakpoints.

### A. Full rows (richest)

**Goal:** Replace generic “Indexed file” with **scannable, truthful** metadata without crowding the subject.

| Priority | Field | UI recommendation |
| -------- | ----- | ------------------- |
| 1 | **`sourceKind`** | Map to short labels: `googleDrive` → “Google Drive”, `localDir` / `file` → “Local files” (exact strings product can tune). |
| 2 | **`indexedRelPath`** | When non-empty, show as **location** (relative path). Combine with `sourceKind` label: e.g. `Google Drive · Finance/Invoices/file.pdf` or `Local · Projects/foo/report.pdf`. Truncate long paths. |
| 3 | **`date`** | Parse ISO; show compact **local date** on the **same line** as source/path **or** a dedicated short line if wrapping is cleaner (`May 1, 2026`). For mail, date helps disambiguate duplicate subjects. |
| 4 | **`snippet`** | Keep as **next** line (already supported). Truncate/clamp as today. |
| 5 | **`bodyPreview`** | Optional fallback when `snippet` empty and `bodyPreview` present (strip/normalize whitespace); **only if** line count stays readable (files with huge previews already truncated server-side). |

**Mail rows:** Continue **`from`** as primary subtitle; **append or second-line `date`** when useful (avoid duplicating subject).

### B. Slim rows (degraded JSON)

**Goal:** Never show **misleading** source labels; **maximize** use of fields that **still exist**.

Available: **`subject`**, **`date`**, optional **`fromName`**.

| Priority | Field | UI recommendation |
| -------- | ----- | ------------------- |
| 1 | **`date`** | **Always** show formatted **`date`** on the secondary line when present — especially for **indexed files** where `fromName` is usually absent. This is the **main** disambiguator slim still carries. |
| 2 | **`fromName`** | If present, prefer **`fromName`** (mail); else fall through. |
| 3 | **Tool context** | If `MailSearchHitPreview` has no `sourceKind` but `search_index` args included **`source`**, optional muted hint: “Matched in source …” **only** when copy is short and non-noisy (may be redundant with tool header). |
| 4 | **Indexed label** | Replace bare “Indexed file” with **“Indexed document”** or **“File”** when **no date** and no inference — avoid implying we know Drive vs local. |

**Do not** invent **`sourceKind`** from filename heuristics alone in slim mode (false confidence).

### C. Server / agent invocation (optional but high leverage)

- If **`search_index`** is invoked with **`limit` ≤ 50** (or any threshold below slim auto), **full** rows are already the ripmail default for **`auto`**. Document that for prompt/tool docs so the model does not routinely ask for 200 rows when a preview card is desired.
- If product wants **consistent** rich previews regardless of count, consider ripmail **`--result-format full`** for **agent-facing** search calls only (tradeoff: token size / payload). That is a **separate** decision from this OPP’s UI work.

### D. Future ripmail consideration (cross-repo)

If slim rows must stay small but **indexed** searches lose too much: consider adding **`sourceKind`** (or a 1-byte **`kind: "mail" \| "file"`**) to **slim** rows — **only** if payload cost is acceptable; coordinate in **[ripmail/docs/OPPORTUNITIES.md](../../ripmail/docs/OPPORTUNITIES.md)** if pursued.

**Drive folder path:** track under [OPP-045](OPP-045-google-drive.md) or a focused ripmail doc: persist **root-relative display path** at index time so **`indexedRelPath`** can match localDir semantics in JSON.

---

## Implementation phases

### Ripmail (full JSON first)

| Phase | Scope |
| ----- | ----- |
| **R1** | Add optional **`indexedRelPath`** to [`SearchResult`](../../ripmail/src/search/types.rs) (`#[serde(rename = "indexedRelPath", skip_serializing_if = "String::is_empty")]`). Thread through [`row_from_cols`](../../ripmail/src/search/engine.rs). Set from **`f.rel_path`** in **`regex_search_files`**; **`""`** elsewhere (mail, Drive until R2). Update **slim** formatter only if product chooses to include a **truncated** path (default: no). |
| **R2** (Drive) | Persist **folder-relative path** during Drive sync; fill **`indexedRelPath`** in **`regex_search_google_drive`**. Schema + migration policy per ripmail early-dev rules (often rebuild index). |

### Brain-app

| Phase | Scope |
| ----- | ----- |
| **P1** | Extend `MailSearchHitPreview` with optional **`date`** and **`indexedRelPath`**; parse both in `parseSearchIndexJsonResult`; **`labelForSearchHitSubtitle`** / row meta helper (sourceKind + path + date + from + slim fallbacks); update **`MailSearchHitsPreviewCard`** and **`MailSearchResultsPanel`** **DRY** ([`contentCardShared`](../../src/client/lib/cards/contentCardShared.ts) or `searchHitRowMeta.ts`). |
| **P2** | Vitest: parser fixtures for **full vs slim** JSON slices; component tests for **indexed + mail** subtitle ordering and **path** truncation. |
| **P3** (optional) | `bodyPreview` fallback when `snippet` empty; tool-arg hint for slim indexed rows. |

---

## Success criteria

- Indexed hits in **full** JSON show **source + relative path** (when ripmail provides `indexedRelPath`) **+ date** (and snippet when present), not only “Indexed file”.
- **LocalDir** hits show **`files.rel_path`–backed** location without a DB migration beyond optional `SearchResult` field.
- **Google Drive** hits show path **once R2** exists; until then, behavior remains filename-only for location **without** fabricating folders.
- **Slim** JSON rows show **date** when available; never claim a specific connector or path without data.
- No regression for **mail** search rows (from, snippet).

---

## Related

- Indexed overlay / PDF: [OPP-075](OPP-075-overlay-native-document-preview-indexed-sources.md)
- Drive source epic: [OPP-045](OPP-045-google-drive.md)
- Unified sources: [ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)
