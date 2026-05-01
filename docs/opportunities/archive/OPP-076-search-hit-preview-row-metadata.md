# OPP-076: Search hit preview rows — metadata, full vs slim JSON

**Status:** Shipped (2026-05-01).

**Created:** 2026-05-01.

**Tags:** ui, ripmail, agent-chat, google-drive

---

## Summary

Chat tool previews for **`search_index`** (`MailSearchHitsPreviewCard`, `MailSearchResultsPanel`) showed a generic **“Indexed file”** subtitle for Drive/local hits because those rows have **no `from`**. Ripmail emits richer fields in **full** search JSON; the web client now parses **`date`**, **`indexedRelPath`**, and **`bodyPreview`**, and maps **`sourceKind`** + path into human-readable subtitles (tiered for **slim** rows).

---

## Shipped

- **Ripmail:** [`SearchResult.indexedRelPath`](../../../ripmail/src/search/types.rs) on full JSON from **`files.rel_path`** for **localDir** hits ([`regex_search_files`](../../../ripmail/src/search/engine.rs)); empty for mail and Google Drive until R2.
- **Brain-app:** [`MailSearchHitPreview`](../../../src/client/lib/cards/contentCardShared.ts) extended fields; [`parseSearchIndexJsonResult`](../../../src/client/lib/tools/matchPreview.ts); [`searchHitRowMeta.ts`](../../../src/client/lib/cards/searchHitRowMeta.ts) for subtitles + snippet/`bodyPreview` fallback; [`MailSearchHitsPreviewCard`](../../../src/client/components/cards/MailSearchHitsPreviewCard.svelte) and [`MailSearchResultsPanel`](../../../src/client/components/MailSearchResultsPanel.svelte) updated.
- **Tests:** Vitest for parser, row meta, and components.

**Agent tip:** `search_index` with **`limit` ≤ 50** keeps ripmail **`auto`** result format **full** ([`SEARCH_AUTO_SLIM_THRESHOLD`](../../../ripmail/src/search/json_format.rs) = 50), which preserves richer preview rows.

---

## Residual

- **R2 (Drive):** Persist **folder-relative path** during Drive sync and emit **`indexedRelPath`** for **`googleDrive`** rows — coordinate with [**OPP-045**](../OPP-045-google-drive.md) / ripmail indexing.
- **P3 (optional):** Tool-arg hint (“Matched in source …”) for slim indexed rows when useful.

---

## Historical detail (spec context)

Ripmail `search --json` builds each row from `SearchResult` ([`ripmail/src/search/types.rs`](../../../ripmail/src/search/types.rs)).

| Shape | When | Typical fields in each `results[]` row |
| ----- | ---- | ---------------------------------------- |
| **Full** | `--result-format full`, or **`auto`** with result count **≤ 50** | `messageId`, `threadId`, `sourceId` (if set), `sourceKind` (if set), `fromAddress`, `fromName`, `subject`, **`date`**, **`snippet`**, `bodyPreview`, `rank`, **`indexedRelPath`** (localDir from `rel_path`) |
| **Slim** | `--result-format slim`, or **`auto`** with **> 50** results | `messageId`, `subject`, **`date`**, optional **`fromName`** — **no** `sourceKind`, **no** `snippet`, **no** `indexedRelPath` unless slim shape changes |

**Indexed location (`indexedRelPath`):** Path relative to the configured corpus root (`/` segments). **Google Drive** filename-only in DB until R2; UI shows connector + date without inventing folders.

---

## Related

- Indexed overlay / PDF: [OPP-075](../OPP-075-overlay-native-document-preview-indexed-sources.md)
- Drive source epic: [OPP-045](../OPP-045-google-drive.md)
- Unified sources: [OPP-087](../../OPP-087-unified-sources-mail-local-files-future-connectors.md)
