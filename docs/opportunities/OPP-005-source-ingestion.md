# OPP-005: Source Ingestion Pipeline

## Problem

The wiki's current ingestion model assumes filesystem access:
- `sources/` folder for immutable source files
- `~/Desktop/lynn/` for health documents
- Agent workflow: "read file in folder, discuss, write wiki page"

This breaks in a containerized deployment:
1. No user-accessible filesystem — can't "drop file in sources/"
2. Different file types need preprocessing — PDFs, spreadsheets, images aren't raw-readable
3. URLs need fetching — "process this article" requires HTTP + extraction
4. Mobile UX — "put file in folder" doesn't work; need upload or share-sheet

**Claude Code comparison:** Claude Code "magically" reads PDFs and images. This comes from:
- Anthropic's API supports PDFs directly (base64 + MIME type)
- Claude Code's infrastructure preprocesses files before the model sees them
- pi-coding-agent's `createReadTool` is text-only — no PDF extraction, no image handling

We need our own preprocessing pipeline.

## Proposal

### 1. Upload endpoint + source registry

```
POST /api/sources/upload
  multipart/form-data: file
  → detect MIME type
  → extract text (PDF, XLSX, DOCX, etc.)
  → store original + extracted in data/sources/
  → return source_id + preview
```

**Source registry** (SQLite table or JSONL):

| Field | Type | Description |
|---|---|---|
| id | string | Unique source ID (src-001) |
| type | enum | upload, url, email_attachment |
| mime | string | MIME type (application/pdf, image/png) |
| origin | string | Original filename, URL, or message_id |
| status | enum | pending, processing, ready, failed |
| original_path | string | Path to original file |
| extracted_text | string | Extracted text content (nullable) |
| created_at | datetime | Upload timestamp |
| ingested_at | datetime | When agent processed into wiki (nullable) |

### 2. File type handlers

| MIME | Handler | Library |
|---|---|---|
| application/pdf | PDF text extraction | pdf-parse or pdf.js |
| application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | XLSX → JSON/text | xlsx |
| application/vnd.openxmlformats-officedocument.wordprocessingml.document | DOCX → text | mammoth |
| text/* | Pass through | — |
| image/* | Vision API (see below) | — |

**For images:**
- Don't extract text — send to Claude's vision API directly
- Store base64 or path for agent to reference
- Agent tool: `describe_image(source_id)` → calls Claude vision, returns description
- Or: include image in message content when user asks about it

### 3. URL ingestion

Extend existing `fetch_page` to optionally register as source:

```
ingest_url(url, { save_as_source: true })
  → fetches page/article
  → stores snapshot + extracted markdown
  → creates source registry entry
  → returns source_id for agent to reference
```

Handles:
- Articles (via existing Supadata API)
- YouTube transcripts (existing tool)
- PDF URLs (fetch + pdf-parse)

### 4. Email attachment extraction

Ripmail already has attachments. Add:

```
list_attachments(query)
  → returns attachments from matching emails

extract_attachment(message_id, attachment_name)
  → downloads attachment from IMAP
  → runs through file type handler
  → returns extracted text or source_id
```

This captures: "I got an email with a PDF, add it to the wiki."

### 5. Agent tools

| Tool | Description |
|---|---|
| `list_sources(status?, type?)` | Query source registry |
| `get_source(source_id)` | Get source metadata + extracted text |
| `describe_image(source_id)` | Send image to vision API, return description |
| `mark_source_ingested(source_id)` | Mark source as processed (updates ingested_at) |

The agent's workflow becomes:
1. User uploads file or pastes URL
2. Preprocessing pipeline extracts text, creates source entry
3. Agent sees notification: "New source: quarterly-report.pdf (ready)"
4. Agent calls `get_source(src-123)`, reads extracted text
5. Agent synthesizes into wiki, calls `mark_source_ingested(src-123)`

### 6. UI surface

Options (pick one or combine):

**A. Upload in chat** — Drag-drop or attach button in chat input. File appears as message, agent sees it.

**B. Sources tab** — Dedicated tab alongside Wiki/Inbox. Shows all sources with status badges (pending, ready, ingested). User can preview, delete, or ask agent to process.

**C. Mobile share sheet** — iOS/Android share extension sends URL/file to brain-app. Appears in Sources or triggers chat.

## Image handling: deeper dive

Images are special — you can't "extract text" in a useful way (OCR is lossy). Options:

**A. Vision-on-demand:** Agent calls `describe_image(source_id)` when needed. Lazy, but adds latency to conversations about images.

**B. Pre-describe:** On upload, automatically call vision API to generate description. Store alongside image. Agent sees description immediately.

**C. Inline vision:** When user asks about an image, include the image directly in the message to Claude (base64 in content array). Most accurate, but only works for active conversation.

**Recommendation:** Combine A + C. Pre-describe for searchability (so grep/wiki search can find "that photo of the house"), but also support inline vision for detailed questions.

## Dependencies

| Library | Purpose | Bundle size |
|---|---|---|
| pdf-parse | PDF text extraction | ~2MB (includes pdf.js) |
| xlsx | Spreadsheet parsing | ~1MB |
| mammoth | DOCX to text | ~200KB |
| sharp (optional) | Image resizing before vision | ~30MB native |

Total: ~3-4MB JS, plus sharp if we resize images.

Alternative: Use external API (like Supadata or Unstructured.io) for extraction. Avoids library maintenance but adds latency and cost.

## Relation to OPP-004

This complements [OPP-004: Wiki-Aware Agent](./OPP-004-wiki-aware-agent.md):
- OPP-004 structures how the agent writes to the wiki (changelog, lint, validation)
- OPP-005 structures how the agent reads external sources (uploads, URLs, attachments)

Together they replace the filesystem-based "drop files in folder, edit markdown files" model with a structured pipeline that works in a container.

## Migration

1. Add upload endpoint + source registry
2. Implement PDF handler (most common case)
3. Add `list_sources` / `get_source` tools to agent
4. Add UI (chat attachment or Sources tab)
5. Migrate existing `sources/` folder content to registry (one-time)
6. Add XLSX, DOCX, image handlers incrementally

## Success criteria

- User can upload a PDF in chat and ask questions about it within 10 seconds
- Agent can ingest a URL without user finding and pasting article text
- Sources are queryable: "what sources did I add last week?"
- Images are searchable by description
