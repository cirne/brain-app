# OPP-075: Overlay native document preview (indexed sources — PDF first)

**Status:** Open.

**Created:** 2026-05-01.

**Tags:** desktop, hosted, ui, ripmail, google-drive

---

## Summary

Today, when the user inspects an **indexed non-mail document** (e.g. Google Drive PDF) from chat or search, the slide-over uses **extracted text** ([`IndexedFileViewer.svelte`](../../src/client/components/IndexedFileViewer.svelte) → `GET /api/files/indexed`, ripmail `read --json`). That matches how we surface **evidence to the model**, but it is **not** how users verify layout-heavy contracts: they want to see the **real document**, the same way inbox thread reading uses **faithful HTML** in an iframe (`emailBodyToIframeSrcdoc` + measured iframe in [`Inbox.svelte`](../../src/client/components/Inbox.svelte)).

This opportunity is to add **end-to-end “original bytes → trusted viewer”** for indexed files: **ripmail** (or brain-app via ripmail) **fetches or streams the raw file**, brain-app exposes an **authenticated, tenant-safe HTTP surface**, and the client **renders by MIME** where we choose to support it — starting with **PDF**, then other formats over time.

**Until then:** the current **Markdown-ish / plain extracted text** presentation remains acceptable; no requirement to “fix” extraction into semantic Markdown for human preview.

---

## Problem

- **Extraction ≠ presentation.** Rust-side text extraction ([`pdf_oxide`](../../ripmail/src/attachments/mod.rs) `extract_all_text`, optional `## filename` wrapper) is tuned for **search and LLM context**, not pixel-perfect reading.
- **Drive (and future sources)** already sync or cache content for indexing; **human inspect** should be able to request **the same bytes** the user would see in Drive / a desktop viewer, not only the derived text.
- **Parity with mail.** Mail already has a polished **HTML body** path for humans; indexed files deserve a comparable **“open the real artifact”** story when the format allows.

---

## Proposed direction

### 1. Raw fetch primitive (ripmail)

Define a **single ripmail capability** analogous to **attachment bytes** for mail: given an indexed **`messageId` / Drive `ext_id`** (and optional `source`), return **`application/octet-stream`** (or temp path + metadata) for the **original or export-normalized file** (PDF export for native Google Docs, etc. — exact rules live in ripmail).

- **CLI shape (illustrative):** `ripmail file export <id> [--source …]` or extend `ripmail read` with `--bytes` / `--out -` — **design choice for ripmail maintainers**; brain-app only needs a **stable subprocess contract**.
- **Reuse:** Drive OAuth + sync already live under [OPP-045](OPP-045-google-drive.md); cache paths under `RIPMAIL_HOME/<source-id>/` are the natural source of truth before hitting the network again.

### 2. Brain-app API

- **New route** (sketch): `GET /api/files/indexed/raw?id=&source=` with the **same auth + path/source policy** as [`files.ts`](../../src/server/routes/files.ts) `GET /indexed` / `GET /read` (tenant allowlists, vault session as today).
- **Response:** `Content-Type` from file MIME, `Content-Disposition` inline vs attachment (product choice), streaming body ideal for large PDFs.

### 3. Client viewer (Svelte)

- **Extend** indexed-file overlay: if MIME is **PDF** (and optionally other types later), show **PDF.js** (or native `<iframe>` / `<embed>` where acceptable) **lazy-loaded** to control bundle size; fall back to **current text/Markdown path** when raw preview unsupported or fetch fails.
- **Worker / Vite:** follow the usual `pdfjs-dist` worker URL pattern (see e.g. community **Svelte 5** wrappers around PDF.js); CSP and bundled-desktop parity must be validated.

### 4. Phasing

| Phase | Scope |
| ----- | ----- |
| **M1** | PDF only, Drive + **localDir** where raw file exists on disk |
| **M2** | Additional viewer MIME types (images already simpler; Office remains non-trivial) |
| **M3** | Optional **signed short-lived URL** / Range requests for huge files |

---

## Non-goals (this OPP)

- Replacing **text extraction** for `read_indexed_file` / FTS / agent tools — **both** stacks coexist.
- **OPP-017** ([multimodal PDFs / vision](OPP-017-multimodal-pdf-scanned-images.md)) — sending images to the **model** is complementary, not required for **human** PDF preview.
- OCR or ML layout-to-Markdown as part of “preview” — out of scope unless a separate initiative owns it.

---

## Acceptance criteria (when implemented)

- From chat **`read_indexed_file`** / indexed-file overlay, user can open **visual PDF** (not only extracted text) for at least **Google Drive** ids covered by sync.
- No weaker **tenant / path** guarantees than today’s read routes ([agent path policy](../../src/server/lib/chat/agentPathPolicy.md), [wiki read vs indexed mail/files](../architecture/wiki-read-vs-read-email.md)).
- **Graceful fallback:** unsupported MIME or fetch error → keep **current text view**.

---

## See also

- [OPP-045 — Google Drive indexed source](OPP-045-google-drive.md)
- [OPP-017 — Multimodal PDFs / vision](OPP-017-multimodal-pdf-scanned-images.md)
- [external-data-sources.md](../architecture/external-data-sources.md)
- Ripmail unified sources: [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md)
