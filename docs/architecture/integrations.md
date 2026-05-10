# External integrations (ripmail, search, files, optional iMessage)

## Trust boundaries: ripmail vs direct SQLite access

**Default pattern:** For **local-first** data that the mail index covers (mail, maildir-adjacent workflows, indexed **files on disk**, **calendar events** once configured — ADR-029 / FTS details on the **Rust snapshot** tag; see [ripmail-rust-snapshot.md](./ripmail-rust-snapshot.md)), the **brain-app** server uses the **TypeScript ripmail module** ([`@server/ripmail`](../../src/server/ripmail/index.ts)) against each tenant’s SQLite + layout under **`$BRAIN_DATA_ROOT/<tenant>/<layout ripmail>/`** ([`shared/brain-layout.json`](../../shared/brain-layout.json)) — derived per request from **`BRAIN_HOME`** / tenant context, not from the parent process **`RIPMAIL_HOME`** env var (which Brain ignores in multi-tenant mode).

**Exception — Apple Messages:** The server may open Apple’s **`~/Library/Messages/chat.db`** read-only via **`better-sqlite3`** (`list_recent_messages`, `get_message_thread`). That path exists because **`chat.db`** is a plain SQLite file on disk; there is **no** Node-accessible **EventKit-style** API for iMessage history **and** no need to ship a native helper solely to read SQL. Access is gated by **Full Disk Access** (or equivalent). This is a **deliberate** second permission surface, not the model for calendar, contacts, or other framework-backed Apple data.

**Tradeoff:** Two trust surfaces (FDA + Node for Messages vs ripmail store for mail/index/calendar direction) rather than one CLI boundary for every corpus. Convergence later (e.g. messaging index via a single native helper) is optional — see **[OPP-083](../opportunities/OPP-083-imessage-and-unified-messaging-index.md)** (iMessage + unified messaging index; distinct from **[brain-app OPP-045: Google Drive](../opportunities/OPP-045-google-drive.md)**). **Calendar/notes/contacts** work should **not** follow the **chat.db** pattern unless we explicitly choose raw SQL over framework APIs.

## Ripmail (TypeScript module)

Mail index **status**, **search**, **read**, **inbox**, **refresh/backfill**, and related routes call **`@server/ripmail`** in-process on the tenant **`ripmail/`** directory. **`GET /api/onboarding/mail`** uses **`ripmailStatusParsed`** (SQLite — no `ripmail status` subprocess).

**Manual CLI:** **`npm run ripmail -- <subcommand>`** (requires the `ripmail` binary on `PATH`). Used only for ad-hoc operator work — not by onboarding, Hub polling, or agent mail tools.

## Unified search (`GET /api/search`)

[`search.ts`](../../src/server/routes/search.ts) combines **wiki** hits (shell `grep` over `*.md` under the wiki dir) and **email** hits (`ripmailSearch` from `@server/ripmail`). Same endpoint powers the UI “search everything” behavior.

## Raw file read (`GET /api/files/read`)

Returns JSON from **`ripmailReadIndexedFile`** (`@server/ripmail`) for allowed paths (e.g. PDF text extraction). Should stay aligned with agent `read_indexed_file` for filesystem targets — see [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md).

## Optional local messages (macOS)

When Apple’s **`chat.db`** is readable, the server exposes iMessage/SMS tools and routes. Read-only access uses **`better-sqlite3`** against a **copy** pattern / readonly open — **not** the main app database for chat persistence (chats remain JSON files). See [`imessageDb.ts`](../../src/server/lib/imessageDb.ts).

## Onboarding

**Persisted onboarding states**, initial mail indexing (**~1y bounded historical slice from indexing**), and API overview: **[onboarding-state-machine.md](./onboarding-state-machine.md)**. [`onboarding.ts`](../../src/server/routes/onboarding.ts) coordinates mail setup, wiki staging, and polling — not a separate product stack, but part of the same Hono app.

---

*See also: [runtime-and-routes.md](./runtime-and-routes.md) · [configuration.md](./configuration.md) · [onboarding-state-machine.md](./onboarding-state-machine.md)*
