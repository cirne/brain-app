# External integrations (ripmail, search, files, optional iMessage)

## Trust boundaries: ripmail vs direct SQLite access

**Default pattern:** For **local-first** data that ripmail already indexes (mail, maildir-adjacent workflows, indexed **files on disk**, **calendar events** once configured in ripmail — see [`ripmail` ADR-029](../../ripmail/docs/ARCHITECTURE.md#adr-029-local-gateway--one-binary-multiple-corpora-mail-calendar-)), the **brain-app** server spawns **`ripmail`** with **`RIPMAIL_HOME`** set on the child env to **`$BRAIN_HOME/<layout ripmail>/`** ([`shared/brain-layout.json`](../../shared/brain-layout.json)) — derived from **`BRAIN_HOME`** only, not from the parent process **`RIPMAIL_HOME`** env var. One subprocess contract, one config + SQLite store under that home.

**Exception — Apple Messages:** The server may open Apple’s **`~/Library/Messages/chat.db`** read-only via **`better-sqlite3`** (`list_recent_messages`, `get_message_thread`). That path exists because **`chat.db`** is a plain SQLite file on disk; there is **no** Node-accessible **EventKit-style** API for iMessage history **and** no need to ship a native helper solely to read SQL. Access is gated by **Full Disk Access** (or equivalent). This is a **deliberate** second permission surface, not the model for calendar, contacts, or other framework-backed Apple data.

**Tradeoff:** Two trust surfaces (FDA + Node for Messages vs ripmail for mail/index/calendar direction) rather than one CLI boundary for every corpus. Convergence later (e.g. messaging index via a single native helper) is optional — see [ripmail OPP-045: iMessage + unified messaging index](../../ripmail/docs/opportunities/OPP-045-imessage-and-unified-messaging-index.md) (not to be confused with [brain-app OPP-045: Google Drive](../opportunities/OPP-045-google-drive.md)). **Calendar/notes/contacts** work should **not** follow the **chat.db** pattern unless we explicitly choose raw SQL over framework APIs.

## Ripmail subprocess

Email and indexed local files are accessed by spawning the **`ripmail`** CLI with `RIPMAIL_HOME` on the child env set to Braintunnel’s ripmail dir (`$BRAIN_HOME/<layout ripmail>/`). No in-process Rust linkage from Node.

- Binary: `RIPMAIL_BIN` (workspace debug binary wired in dev when present — see [`run-dev.mjs`](../../scripts/run-dev.mjs)); Tauri bundles release `ripmail` in `server-bundle/`.
- Agent tools wrap `ripmail search`, `ripmail read`, `ripmail draft`, `ripmail inbox`, etc.

## Unified search (`GET /api/search`)

[`search.ts`](../../src/server/routes/search.ts) combines **wiki** hits (shell `grep` over `*.md` under the wiki dir) and **email** hits (`ripmail search --json`). Same endpoint powers the UI “search everything” behavior.

## Raw file read (`GET /api/files/read`)

Returns JSON from `ripmail read <path> --json` for absolute paths (e.g. PDF text extraction). Should stay aligned with agent `read_indexed_file` for filesystem targets — see [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md). Both use shared Node `exec` options (`maxBuffer` 20 MiB, timeout 120s) in [`ripmailReadExec.ts`](../../src/server/lib/ripmailReadExec.ts); Node’s default 1 MiB buffer would throw on large extractions.

**Inbox message body** (`GET /api/inbox/:id`, plain `ripmail read`) uses the same limits.

## Optional local messages (macOS)

When Apple’s **`chat.db`** is readable, the server exposes iMessage/SMS tools and routes. Read-only access uses **`better-sqlite3`** against a **copy** pattern / readonly open — **not** the main app database for chat persistence (chats remain JSON files). See [`imessageDb.ts`](../../src/server/lib/imessageDb.ts).

## Onboarding

[`onboarding.ts`](../../src/server/routes/onboarding.ts) coordinates mail setup, staging wiki, and polling — not a separate product stack, but part of the same Hono app.

---

*See also: [runtime-and-routes.md](./runtime-and-routes.md) · [configuration.md](./configuration.md)*
