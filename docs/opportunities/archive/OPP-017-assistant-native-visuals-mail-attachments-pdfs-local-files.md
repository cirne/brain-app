# Archived: OPP-017 — Assistant-native visuals (mail, attachments, PDFs, local files)

**Status: Archived (2026-05-12).** **Shipped:** shared **`visualArtifacts`** contract (`shared/visualArtifacts.ts`), ripmail normalization (`src/server/ripmail/visualArtifacts.ts`), authenticated file surfaces (`src/server/routes/files.ts`), tool/stream adapters, Assistant transcript cards (`VisualArtifactsPreviewCard`, `VisualArtifactImageViewer`). **Tests:** e.g. `src/server/ripmail/visualArtifacts.test.ts`, `src/server/routes/files.test.ts`, `src/client/components/cards/VisualArtifactsPreviewCard.test.ts`.


---

## Original spec (historical)

### OPP-017 — Assistant-native visuals (mail, attachments, PDFs, local files)

**Status:** Future *(pre-archive narrative; scope implemented 2026-05-12)*  
**Scope:** Braintunnel Assistant UI (`Assistant`, chat transcript, right dock / overlays), agent tools (`read_mail_message`, `read_indexed_file`, files APIs), **`src/server/ripmail/`** read/search pipeline

## Problem

Today the threaded conversation is overwhelmingly **text-shaped**: bodies, excerpts, summaries. Meanwhile users routinely work with **images and image-like documents**:

- Email with **embedded or attached photos** (receipts, screenshots, forwarded camera rolls).
- **PDFs that are scans or slides** — little extractable text, high visual signal.
- **Standalone image files** in indexed local folders.

The agent may eventually *infer* meaning via multimodal APIs, but the **product gap** is wider: users expect **“show me that picture”** to produce an actual image in the Assistant surface — not only a textual description — and they expect the **same interaction pattern** whether the source was an attachment, an inline MIME part, or page 3 of a PDF.

Without a deliberate **visual artifact** model across server, tools, model, and UI, each medium gets one-off hacks and the experience stays fragmented.

## Product vision

**Make images (and rasterized PDF pages) a natural part of the Assistant experience:**

1. **User intent** — Commands like “show the photo Maria sent”, “what’s in the attachment”, “zoom the receipt”, “flip to the diagram on page 5” resolve to concrete **visual content** plus optional explanation.
2. **Agent cognition** — The model receives **vision-capable payloads** where appropriate (thumbnails, full frames, capped page budgets) alongside honest **read metadata** (`readStatus`, hints, provenance).
3. **Presentation** — The client renders visuals through **shared UI primitives**: **inline** in the transcript where a compact preview helps; **expanded** in the right panel / dock or **overlay** when the user asks to focus — same viewer behaviors (pinch/zoom/next page) wherever the artifact came from.

PDFs stay in this story as **sequences of raster or vector-capable artifacts** — not as a parallel “PDF feature” divorced from mail images.

## Unified architecture (implementation north star)

Drive one pipeline with **four layers** reused across mail, attachments, indexed files, and PDFs:

| Layer | Responsibility |
| --- | --- |
| **Canonical reference** | Stable, tenant-scoped ids: message + part id, indexed file path + optional page index, hash or cache key for bytes. Anything the UI can fetch or the model can cite without ambiguity. |
| **Fetch & normalize** | Ripmail / Hono resolves refs to bytes or to **deterministic renders** (e.g. PDF page → bitmap at bounded DPI). Enforce caps (size, page count, pixels) for cost and latency. |
| **Tool & message contract** | Agent tools return **structured payloads** alongside text: e.g. `visualArtifacts[]` with `{ kind, mime, ref, label?, width?, height? }` plus human-readable summaries. Streaming path can attach or follow up with artifact metadata so the UI can lazy-load media. Multimodal model calls reuse the same normalization path. |
| **Client rendering** | **One family of components** (“visual block”, “focused viewer”) driven by artifact metadata: inline thumbnails, expandable detail, overlay. Placement (inline vs right vs modal) is a **presentation mode**, not different data types per source medium. |

**Design rule:** *Same artifact type from different origins* (JPEG attachment vs PNG inline vs rendered PDF page) should differ only in **reference and provenance**, not in React/Svelte viewer code or prompt shape.

## Use cases (non-exhaustive)

- **Mail image attachment** — User: “Show me the image John attached yesterday.” Agent resolves message → part → artifact ref → UI shows inline and offers expand.
- **Inline MIME image** — Body references or CID parts map to artifacts like attachments.
- **“What does this picture say?”** — Vision path + OCR-style behavior where the model reads text in the image; UI still surfaces the raster for trust.
- **Scanned / image-heavy PDF** — Builds on honest `readStatus` / token-efficient hints: pages become **artifacts** in order; transcript can show thumb strip + “focus page N” in dock.
- **Local indexed image/PDF** — Same artifact contract via `read_indexed_file` (or successor) instead of mail-specific tools.
- **User-initiated zoom / compare** — Focused overlay reuses artifact fetch; optionally two artifacts side-by-side without new backend concepts.

## Direction (delivery, not exhaustive task list)

1. **Artifact schema + API** — Server endpoints or signed URLs (as security model demands) to resolve `ref` → bytes; shared validation and limits.
2. **Ripmail / read pipeline** — Expose image bytes, inline parts, and **PDF page surfaces** through the same normalization layer; keep **honest text status** for empty/garbage extraction as the prerequisite behavior.
3. **Agent tools** — Emit `visualArtifacts` (or equivalent) from `read_mail_message`, file reads, and PDF paths; wire multimodal requests to the same normalized inputs.
4. **Assistant UI** — Transcript blocks for visual artifacts; optional right-dock / overlay viewer; loading, error, and “too large / redacted” states consistent across sources.
5. **Polish later** — Caching across turns, prefetch when the user hovers expand, accessibility (alt text from model or metadata), telemetry for vision cost.

## Relation to shipped / prerequisite work

Structured `readStatus` + hints for **image-heavy PDFs** and similar (`ripmail read` JSON, indexed local dirs) remain the **baseline**: no hallucinated bodies, clear signals when text extraction is worthless. **This OPP** is the **product track on top**: artifacts, vision, and **first-class** Assistant rendering — one architecture for mail images, embedded images, scanned PDFs, and local visuals.

## See also

- [Wiki read vs indexed mail/files](../../architecture/wiki-read-vs-read-email.md)
- **[archived OPP-087](./OPP-087-unified-sources-mail-local-files-future-connectors.md)** — unified sources (**stub:** [../OPP-087-unified-sources-mail-local-files-future-connectors.md](./OPP-087-unified-sources-mail-local-files-future-connectors.md))
