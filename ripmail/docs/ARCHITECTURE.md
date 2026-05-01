# Architecture & Design Decisions

This document tracks concrete architectural decisions made during design and development.
See [VISION.md](./VISION.md) for the product vision and goals.

**Why one file:** ADRs cross-reference each other heavily (e.g. ADR-016 → ADR-017 → ADR-020) and an agent making an architectural decision benefits from scanning the full decision log for context and shape, not just one answer. Keeping everything here also means grep and semantic search find everything without following links. If this file grows unwieldy (say, past ADR-030), split into individual files under `docs/adr/` with an index table here — same pattern as [OPPORTUNITIES.md](./OPPORTUNITIES.md).

**Rust implementation:** Tracker, intentional differences vs historical Node, and ecosystem risks — [RUST_PORT.md](./RUST_PORT.md) (companion to [ADR-025](#adr-025-rust-port--parallel-implementation-pre-cutover)).

---

## Decision Log

### ADR-001: Phase 1 Scope — IMAP Sync → SQLite → Agent CLI

**Decision:** The minimum useful Phase 1 system is:

```text
IMAP provider → raw email store → SQLite FTS5 index → CLI (agents invoke `ripmail` as a subprocess)
```

**Rationale:** If you can search your own email from an agent (Cursor, Claude Desktop) in natural language, the core value is proven. Everything else — filesystem interface, semantic embeddings, replacement SMTP mode — comes later.

**Deferred:** Filesystem (FUSE) interface, SMTP ingress (MX hosting), semantic/vector search, multi-user. **Send (SMTP outbound)** is implemented as send-as-user SMTP ([ADR-024](#adr-024-outbound-email--smtp-send-as-user--local-drafts)); product sequencing may still prioritize read/sync quality before promoting send broadly.

---

### ADR-002: Storage — Embedded + Persistent Volume Throughout

```text
Container
└── /data  (persistent volume — survives redeploys)
    ├── maildir/           ← raw .eml files
    ├── ripmail.db           ← SQLite: metadata, FTS5 index, sync state
    ├── vectors/           ← (deferred) LanceDB embedded
    └── embedding-cache/   ← (deferred) OpenAI embedding responses by (model, input hash)
```

This layout applies to **both Phase 1 and Phase 2 (open source)**. Each user runs their own container with their own volume. There is no shared infrastructure to scale.

**Phase breakdown:**

| Phase | Description | Storage |
| --- | --- | --- |
| Phase 1 | Personal deployment | Container + DO persistent volume |
| Phase 2 | Open source release | Docker Compose, each user brings their own volume |
| Phase 3 | Hosted SaaS (if ever) | Stateless container + S3 + Postgres |

**Rationale:** Phase 2 is open source self-hosting — not a multi-tenant service. S3 and Postgres are only needed if/when a hosted SaaS is built (Phase 3). Keeping everything embedded avoids S3 SDK complexity, network latency on every read, and bucket credential management. A volume snapshot is a complete backup.

**Volume sizing:** 10 years of heavy Gmail (500K emails) with embeddings lands at ~20GB. A $2/mo DO volume is sufficient with headroom.

**Result:** The raw email store (Maildir) is the durable artifact. The SQLite index and LanceDB vectors are always rebuildable from it without touching IMAP.

---

### ADR-003: IMAP Sync Resumption via UID Checkpointing

**See also:** [SYNC.md](./SYNC.md) — Current sync implementation and optimization history.

**Decision:** Sync state is tracked per folder as `{ folder, uidvalidity, last_uid }`. The public command is unified as `ripmail refresh`, but it still uses two distinct internal sync strategies for different use cases:

1. **Incremental update (`ripmail refresh`):** Uses the forward sync path to fetch only new messages since last sync. This is the default, freshness-first path and is intended to make the newest unseen mail searchable as quickly as possible.
2. **Backfill update (`ripmail refresh --since …`):** Uses the backward sync path, resumes from oldest synced date, and uses UID filtering to skip already-synced messages. This is the explicit coverage-expansion path for initial setup and history backfill.

**Rationale:** IMAP UIDs are stable, monotonically increasing identifiers. Checkpointing the last-seen UID per folder allows sync to resume exactly where it left off after a redeploy, crash, or restart — without re-downloading previously synced messages. `UIDVALIDITY` detects the rare case where a folder was wiped and recreated, triggering a full re-sync of that folder.

**Operational contract:**

- Plain `ripmail refresh` should prioritize freshness over completeness. It should fetch the newest unseen mail first and make it available to `search`, `read`, and `inbox` as soon as it is indexed.
- `ripmail refresh --since …` should prioritize historical coverage. It should walk backward only as far as needed to satisfy the requested window.
- Neither path should re-fetch or re-index messages already present locally except for narrow same-day safety overlap during backward resumption; UID filtering and duplicate checks are the guardrails.

**Efficiency optimizations:**

- **Forward sync:** UID range search (`UID N:*`) only queries IMAP for messages we haven't synced yet. Server-side filtering avoids fetching headers for messages we already have.
- **Backward sync:** When resuming from oldest synced date, if all UIDs from a search are <= `last_uid`, we skip fetching entirely and search before that date instead. This avoids re-fetching 100+ messages we already have when extending a date range.
- **Same-day safety:** Backward sync allows re-fetching from the same day as oldest synced to catch gaps from interrupted syncs, but uses UID filtering to skip messages we've already synced.

**Result:** The raw email store (Maildir or R2) is the durable artifact. The index is always rebuildable from the raw store without touching IMAP. Both sync modes are optimized to avoid unnecessary fetches while maintaining correctness.

---

### ADR-004: Local Dev — Sync Last N Days by Default

**Decision:** Local development syncs only the last 7 days of email by default. Production deployments do a full historical backfill.

**Rationale:** IMAP sync is bandwidth-heavy. Developers shouldn't wait for a full archive sync on every fresh checkout. A `--full` flag (or env var) enables full sync explicitly.

---

### ADR-005: Agent Interface — Native CLI (Primary)

**Decision:** The system exposes a **native CLI binary** as the agent interface on the same SQLite index. **Historical:** an in-repo MCP stdio server existed; it was **removed** to focus on baking the CLI contract first — reintroduction is tracked in [OPP-039](opportunities/OPP-039-mcp-deferred-cli-first.md).

**CLI commands (representative):**

```text
ripmail refresh [--since <spec>]    ← Update local mail index; `--since` backfills older mail
ripmail search <query> [flags]    ← FTS5 full-text search
                                  Query supports inline operators: from:, to:, subject:, after:, before:
                                  Example: ripmail search "from:alice@example.com invoice OR receipt"
ripmail who [query] [flags]        ← people by address or display name; owner-centric counts + contactRank sort when owner configured ([OPP-077](../../../docs/opportunities/OPP-077-who-smart-address-book.md)); omit query for top contacts
ripmail status [--imap]           ← sync/indexing/search readiness (--imap for IMAP server comparison)
ripmail stats                     ← DB stats (volume + top senders/folders)
ripmail read <id> [--raw]         ← read a message (or: ripmail message <id>)
ripmail thread <id> [--json]      ← fetch full thread (text by default; --json for structured output)
```

**Sync modes:**

- **`ripmail refresh --since …`** (backward path): Initial setup and backfill. Resumes from oldest synced date, fills gaps going backward. Uses date-based search with UID filtering to skip already-synced messages.
- **`ripmail refresh`** (forward path): Frequent updates. Uses UID range search (`UID ${last_uid + 1}:*`) to fetch only new messages. Much faster than date-based search for incremental updates.

**Rationale:** Agents like Claude Code and OpenClaw can invoke shell commands directly. A subprocess call to `ripmail search` requires no long-lived server and no port management. The CLI defaults to JSON for structured commands (`search`, `who`, `attachment list`) so agents can consume output directly. See [ADR-022](#adr-022-cli-output-format--json-default-for-structured-commands-text-for-progressivecontent-commands) for output format decisions.

**In-repo implementation** is **Rust** at the **repository root** (ADR-025). **Historical:** a TypeScript CLI was published as **`@cirne/zmail`** on npm; that code lived under **`node/`** until cutover (removed — see git history, [RUST_PORT.md](RUST_PORT.md)). The CLI JSON shapes and `~/.ripmail` layout are the stable agent contract.

**See also:** [OPP-004: People Index and Writable Contacts](opportunities/archive/OPP-004-people-index-contacts.md) — roadmap for people index at index time and `ripmail contact`.

---

### ADR-006: Storage Layers

**Decision:** Four distinct storage layers, each optimized for its access pattern:

| Layer | Phase 1 + 2 | Phase 3 (hosted SaaS, if ever) |
| --- | --- | --- |
| Raw email files | Maildir on persistent volume | S3 / DO Spaces |
| Structured metadata + FTS | File-backed SQLite (**Rust:** `rusqlite` bundled; **historical Node:** `better-sqlite3`; ADR-023) | Postgres |
| Semantic / vector search | (deferred) LanceDB on volume | LanceDB → S3 |

**SQLite schema (Phase 1):**

```text
mailboxes     (folder, uidvalidity, last_uid)
messages      (message_id, thread_id, from, to, subject, date, body_text, ...)
threads       (thread_id, subject, participant_count, last_message_at)
contacts      (address, display_name, message_count)
attachments   (message_id, filename, mime_type, size, stored_path)
sync_state    (folder, uidvalidity, last_uid)
```

FTS5 virtual tables on `body_text` and `subject` live in the same `.db` file.

**Full-text search:** SQLite FTS5. Handles millions of emails with sub-100ms queries. No external service, runs in-process, trivially backed up as a single file.

**Vector / semantic search (deferred):** Current implementation is FTS-only ([OPP-019 archived](opportunities/archive/OPP-019-fts-first-retire-semantic-default.md)). LanceDB and embedding generation may be reintroduced later; design assumed LanceDB embedded on volume, S3 backend for Phase 3.

---

### ADR-007: Security Baseline

**Decisions:**

- **IMAP auth:** **Gmail app passwords** remain a simple default when the account supports them. **Google OAuth** (Desktop PKCE + loopback, refresh tokens per mailbox, **SASL XOAUTH2** for IMAP/SMTP) is **first-class** for accounts that cannot use app passwords — see [ADR-011](#adr-011-email-provider--imap-first-gmail-as-priority-target) and [OPP-042](opportunities/OPP-042-google-oauth-cli-auth.md).
- **Secrets:** IMAP passwords, OAuth refresh tokens, and API keys live in **`RIPMAIL_HOME`** (and optional merged **repo-root `.env`** for dev); use environment variables and local files — never commit credentials to the repo.
- **Storage encryption:** Fly.io volumes are encrypted at rest by default. Raw email is never transmitted without TLS.

---

### ADR-008: Language & Runtime — TypeScript + Node.js (historical)

**Status:** **Superseded in-repo** by the Rust implementation at the repository root ([ADR-025](#adr-025-rust-port--parallel-implementation-pre-cutover)). This ADR records the **original** decision and remains useful context for **ADR-023** (SQLite native addon / npm global-install behavior on the old stack).

**Original decision:** TypeScript on Node.js 20+. Distribution was `npm install -g @cirne/zmail` (see [OPP-007 archive](opportunities/archive/OPP-007-packaging-npm-homebrew.md)). The implementation lived under **`node/`** until removal; use **git history** to inspect it.

**Rationale (historical):**

- Node.js was ubiquitous; **better-sqlite3** for file-backed SQLite; **imapflow** for IMAP.
- **ABI recovery** and **`bundledDependencies`** for global installs are documented in [ADR-023](#adr-023-sqlite-access--file-backed-native--async-facade--abi-recovery) as the Node-era story.

---

### ADR-009: Hosting — DigitalOcean

**Decision:** DigitalOcean App Platform for container hosting.

**Phase 1 + 2:** App Platform container + DO persistent volume
**Phase 3 (if ever):** App Platform container + DO Spaces + DO Managed Postgres

**Rationale:**

- Already in use for other projects — no new account, billing, or mental model.
- App Platform handles Docker + GitHub auto-deploy + persistent volumes without managing a raw VM.
- DO Spaces (S3-compatible) and DO Managed Postgres are available in-platform if Phase 3 is ever needed.
- AWS adds IAM/ECS/ALB complexity that isn't justified at this stage.

### ADR-010: Storage Abstraction

**Decision:** File storage access is behind a `StorageAdapter` interface, but defaults to `LocalAdapter` for both Phase 1 and Phase 2.

**Implementations:**

- `LocalAdapter` — reads/writes to local filesystem path (default for all phases)
- `S3Adapter` — reads/writes to any S3-compatible bucket (Phase 3 / power-user option)

**Rationale:** The abstraction keeps the option open without requiring it. A user who wants to back up their Maildir to S3 can configure an `S3Adapter`. The default experience requires no cloud credentials.

---

### ADR-011: Email Provider — IMAP-first, Gmail as Priority Target

**Decision:** Use IMAP as the sync protocol (not the Gmail REST API). Gmail is the priority provider with a dedicated implementation to handle its quirks.

**Why IMAP over the Gmail API:**

- IMAP generalizes to Fastmail, iCloud, Outlook — one sync engine covers all providers.
- Gmail API requires OAuth regardless, locks Phase 1 to Gmail only, and adds REST client complexity before the core system exists.
- Gmail's proprietary IMAP extensions (`X-GM-THRID`, `X-GM-LABELS`) provide native thread IDs and labels — no need for the REST API.

**Gmail-specific behavior:**

- Always sync from `[Gmail]/All Mail`, never individual label folders. Labels appear as IMAP pseudo-folders; syncing them individually downloads the same message multiple times.
- Use `X-GM-THRID` for thread IDs (stable, Gmail-native). Fall back to `References`/`In-Reply-To` header parsing for non-Gmail providers.
- Use `X-GM-LABELS` for label mapping.
- Throttle initial backfill to respect Gmail's IMAP bandwidth limits (~250MB/day).

**Auth (Gmail):**

- **App password** (Gmail → Security → 2-Step Verification → App Passwords) when available — stored like other IMAP secrets (`RIPMAIL_IMAP_PASSWORD` / per-mailbox `.env`).
- **Google OAuth** when app passwords are unavailable or the user prefers browser consent: **`ripmail setup --google-oauth`** or **`ripmail wizard --gmail`** — Desktop OAuth client, loopback redirect, refresh token under **`~/.ripmail/<mailbox_id>/google-oauth.json`**, **`imapAuth: "googleOAuth"`** in config; IMAP and SMTP use **XOAUTH2** with the same access-token lifecycle. Details: [OPP-042](opportunities/OPP-042-google-oauth-cli-auth.md), [AGENTS.md](../AGENTS.md).

**Provider abstraction:**

```text
ImapProvider (interface)
├── GmailProvider         ← All Mail strategy, X-GM-* extensions
├── GenericImapProvider   ← standard IMAP, header-based threading
└── (others follow GenericImapProvider)
```

---

### ADR-012: Attachment Extraction — Agent-Friendly Markdown Output

**Status: Implemented.**

**Decision:** Attachments are captured during sync (raw files written to disk, metadata inserted into DB), and extraction to text happens on-demand when first read. Extracted text is cached in the `attachments.extracted_text` column and reused on subsequent reads. This keeps sync fast while making extracted content immediately available to agents.

**Extraction libraries (TypeScript-native, Node-compatible):**

| Format | Library | Output | Status |
| --- | --- | --- | --- |
| PDF | `@cedrugs/pdf-parse` | Text | Working — tested on IRS W-9, NetJets invoices, RFC docs |
| DOCX | `mammoth` | Markdown | Working — tested on multi-page documents |
| XLSX/XLS | `exceljs` | CSV | Working — tested on Microsoft sample data, NetJets flight activity |
| CSV | passthrough | CSV | Working |
| HTML | `turndown` | Markdown | Working — strips tags, preserves structure |
| TXT | passthrough | Text | Working |
| Other | — | null | Returns null (unsupported) |

**Library notes:**

- `@cedrugs/pdf-parse` (fork of pdf-parse v1 API): works in Node. The original `pdf-parse` v2 depends on `pdfjs-dist` which requires `DOMMatrix` / canvas — not available in headless Node.
- `exceljs`: handles real `.xlsx` files correctly. The SheetJS community edition (`xlsx` v0.18.5) cannot parse modern XLSX files.
- `mammoth`: converts DOCX to markdown natively, best-in-class for Word docs.
- **Rust (primary prebuilt binary):** PDF text uses **`pdf_oxide`** only (`extract_all_text`); MIME `application/pdf` (with parameters) or a `.pdf` filename selects the PDF path; panics are caught so the CLI returns a stub instead of aborting. Parity notes: [RUST_PORT.md](RUST_PORT.md).

**Storage:**

- Raw attachment files: `maildir/attachments/<message_id>/<filename>` on volume
- Extracted text cached in `attachments.extracted_text` column (populated on first read)
- Future: sibling-file caching (`<filename>.md` or `<filename>.csv`) for faster reads without DB lookup

**On-demand extraction flow:**

1. `ripmail attachment read <id>` called
2. Check DB `extracted_text` column
3. If populated: return cached content
4. If null: read raw file → run extractor → update DB → return text

**Agent interface:**

```text
CLI:  ripmail attachment list <message_id>        → JSON array of attachments
      ripmail attachment read <attachment_id>      → markdown/CSV text (stdout)
      ripmail attachment read <attachment_id> --raw → raw binary (stdout)
```

**Agent workflow example:**

```text
1. ripmail search "agreement from fred"      → finds message abc123
2. ripmail read abc123                       → body shows attachments: [{id:7, filename:"Agreement.pdf"}]
3. ripmail attachment read 7                 → outputs markdown text of the PDF
4. Agent summarizes the agreement
```

**Test coverage:** `tests/attachments/extractors.test.ts` — 9 tests covering all supported formats plus unsupported format handling. Fixtures in `tests/attachments/fixtures/` include real-world files (IRS W-9, RFC 791, Microsoft sample data).

---

### ADR-013: Initial Sync Strategy — Iterative Windows, Most Recent First

**Decision:** Sync in expanding reverse-chronological windows so recent email is searchable within seconds, not after a full archive download.

**Window schedule:**

```text
Window 1:  last 24 hours     → target: searchable within ~30 seconds
Window 2:  previous 6 days   → target: searchable within ~2-5 minutes
Window 3:  previous 3 weeks
Window 4:  previous 2 months
Window 5:  remaining to target date
```

Each window fetches, parses, and indexes completely before the next begins. IMAP `UID SEARCH SINCE <date>` defines each window; UIDs are fetched highest-first within the window so most recent messages arrive first.

**Default backfill:** 1 year. Set via CLI: `ripmail refresh --since 7d | 5w | 3m | 2y` (default: 1y). Override default via `sync.defaultSince` in config.json.

**Resume behavior:** When running `ripmail refresh --since …` with a longer date range than previously synced, it automatically resumes from the oldest synced date and continues backward. For example, if you've synced 7 days and run `ripmail refresh --since 14d`, it will only fetch messages from days 8-14, skipping the already-synced first 7 days entirely.

**Crash recovery:** Each window is atomic — if sync crashes mid-window, it restarts from the beginning of the incomplete window. No partial state to reconcile.

**Progress estimation:** `(today − earliest_synced_date) / (today − target_date) × 100`. Always accurate because the earliest fully-synced date is known precisely.

**Sync state schema:**

```sql
sync_windows  (id, phase, window_start, window_end, status,
               messages_found, messages_synced, started_at, completed_at)
sync_summary  (earliest_synced_date, latest_synced_date, total_messages,
               last_sync_at, is_running, owner_pid, sync_lock_started_at)
```

---

### ADR-014: Web UI — Hono + HTMX, Server-Rendered

**Status: Deferred.** The web UI has been removed. The **CLI** is the supported interface. Onboarding is via `ripmail setup` and AGENTS.md. If a web UI is reintroduced later, this ADR describes the intended design.

**Decision (historical):** The service was to include a web UI for onboarding, sync status, and test search. Built with Hono (Bun-native HTTP framework) + HTMX. No client-side build step, no bundler, no framework.

**Rationale:** This is a single-user admin UI. Server-rendered HTML with HTMX polling/SSE for live sync status is faster to build and easier to maintain than a React SPA.

**Service surfaces (historical):**

```text
Single Bun process
├── /           Web UI (Hono + HTMX)
└── background  Sync daemon (runs as async task in same process)
```

**Onboarding flow (historical):** `/setup` → Sign in with Google, IMAP app password, live sync status, test search. `/dashboard` → Sync status + search. Current onboarding: `ripmail setup` (CLI) and AGENTS.md.

---

### ADR-015: Web UI Auth — Google OAuth

**Status: Deferred.** Web UI has been removed; this ADR is retained for context if a web UI is reintroduced.

**Decision (historical):** The web UI was to be protected by Google OAuth sign-in.

**Rationale:** Two benefits in one: (1) Protects the admin UI without a separate password system. (2) Establishes Google OAuth infrastructure for potential Phase 2 IMAP auth. Implementation: standard Google OAuth 2.0 PKCE flow, session as signed cookie.

---

### ADR-016: Sync Performance — Bandwidth-Bound as Goal

**See also:** [SYNC.md](./SYNC.md) — Performance optimizations and current bottlenecks.

**Decision:** Sync speed is of paramount importance. The target is to saturate I/O: the sync pipeline should be limited by available network bandwidth (or disk throughput when writing), not by CPU, concurrency limits, or unnecessary serialization. If IMAP sync is not bound by available bandwidth, it has room for improvement.

**Rationale:** Users with large mailboxes need backfill and incremental sync to finish as fast as the provider and link allow. Being bandwidth-bound means we have eliminated avoidable bottlenecks (e.g. single-connection fetch, one-at-a-time parsing, blocking on index writes). This principle guides choices around parallel fetch, connection reuse, pipelining, and batching so that the only remaining limit is physics — how much data the network and disk can move.

**Result:** When optimizing sync, the question to ask is: are we maxing out the pipe? If not, the design or implementation should be improved until we are.

---

### ADR-017: Sync Design — Priority, Batching, and Backoff

**See also:** [SYNC.md](./SYNC.md) — Current batching implementation and performance results.

**Decision:** Sync is timestamp- and folder-priority focused, avoids chatty-protocol slowdowns, and uses smart backoff when the provider complains.

#### Priority

- **Most recent first:** Newest messages and most important folders (e.g. INBOX, [Gmail]/All Mail) get highest priority so recent mail is searchable quickly. This aligns with ADR-013’s windowed strategy but applies continuously: within and across folders, prefer recent-by-date and high-value folders.
- **Goal:** Users see today’s mail and key folders synced before deep archive backfill.

#### Avoid chatty protocols (or parallelize if we must)

- IMAP can be slow when used in a chatty way (many small round-trips, one message per request). Learn from download managers (e.g. Steam, browser downloaders): batch fetches, multiple parallel streams, and large reads so the pipeline is limited by bandwidth, not RTT or command count.
- **Apply to email sync:** Prefer batching (e.g. ranges of UIDs or chunked FETCH), concurrent connections where the provider allows, and pipelining to minimize round-trips per byte. The aim is to saturate the network, not to tickle it with small requests.
- **When the protocol stays chatty:** If we cannot avoid chatty usage (e.g. provider or protocol limits on batch size), run many workers in parallel. Many concurrent connections or workers each doing small requests can still saturate the link; latency is amortized across parallelism. Prefer batching first, then scale out with workers.
- **Rationale:** Chatty protocols leave bandwidth on the table when run single-threaded; batching reduces chattyness, and parallelism is the fallback to become bandwidth-bound (ADR-016) when batching alone is insufficient.

#### Smart, fast backoff

- When the IMAP provider signals backpressure (e.g. rate limit, “try again”, connection throttling, errors), back off so we don’t hammer the server — but resume aggressively when the provider is happy again.
- **Smart:** Back off in proportion to the signal (e.g. respect Retry-After or error type; avoid overly long sleeps when a short pause suffices).
- **Fast:** Once the provider allows, ramp back to full throughput quickly. Avoid conservative backoff that keeps sync slow long after the provider has recovered.
- **Rationale:** We want to be good citizens and avoid bans, while still achieving saturation whenever the provider and network allow.

**Result:** Sync design should explicitly address: (1) ordering work by timestamp and folder importance, (2) batching and parallelism to avoid chatty IMAP and saturate the link, and (3) backoff that is both respectful and fast to recover.

---

### ADR-018: Sync Observability — Synchronous Run + Observable Progress

**Decision:** Sync runs **synchronously**. Progress is observable in two ways so agents (or humans) can infer status and speed without introducing a job queue:

1. **Periodic progress to stdout** — During sync, emit progress lines at a regular cadence (e.g. every N messages or every few seconds): messages fetched so far, bytes downloaded, elapsed time, throughput (msg/min). When the run finishes, always emit a final metrics block (messages new/fetched, bytes, bandwidth, msg/min, duration).
2. **Pollable progress** — Write current-run progress to a well-known place (e.g. a progress file under RIPMAIL_HOME/data or fields in sync_summary / a small table) so another agent or process can poll (e.g. `ripmail status` or reading a file) and report status even when the runner does not stream stdout.

We do **not** introduce async job IDs or a job queue for sync unless we later need multiple concurrent syncs or very long-running jobs that must outlive a single CLI invocation.

**Rationale:** Agent-first (VISION) means the primary consumers of the CLI are agents (Claude Code, OpenClaw, Pi, etc.). They invoke `ripmail refresh` as a subprocess. Some environments stream stdout, so periodic progress lines give live feedback; others only return output on exit, so the final metrics block is still available. A pollable source (file or DB + `ripmail status`) lets a *different* agent or process observe “sync in progress” without depending on streaming. Keeping sync synchronous avoids job storage, lifecycle, and daemon complexity for the common case (single-user, single sync at a time).

**Result:** Sync is fast, accurate, and reports how fast it was (ADR-016/017). It also makes progress observable so other agents can inspect and report status as it goes.

---

### ADR-019: Data Duplication — What Lives in SQLite vs. Raw Store

**Decision:** The `messages` table stores `body_text` but **not** `body_html`. HTML content is read on demand from the raw `.eml` file via `raw_path`.

**Data residency by layer:**

| Data | Canonical store | Also in SQLite? | Why |
| --- | --- | --- | --- |
| Raw email (MIME) | `.eml` file in `maildir/` | No | Canonical artifact — everything rebuilds from this |
| `body_text` | `.eml` file | **Yes** — `messages.body_text` | Required for FTS5. The external-content FTS5 table (`content='messages'`) reads from this column for indexing and `snippet()` generation. Removing it would break full-text search. |
| `body_html` | `.eml` file | **No** | Not indexed, not searched. Parse from `.eml` on demand when rendering is needed. |
| Embeddings | (deferred) LanceDB | No | Current implementation is FTS-only; vector layer removed ([OPP-019 archived](opportunities/archive/OPP-019-fts-first-retire-semantic-default.md)). |
| Metadata (from, to, subject, date, labels) | `.eml` headers | **Yes** — `messages.*` columns | Needed for filtering, sorting, and display without parsing `.eml` on every query. |

**Rationale:** The guiding principle is: the raw `.eml` store is the durable artifact; SQLite is a rebuildable index (ADR-002). Data should only be duplicated into SQLite when it is required for indexing or high-frequency queries. `body_text` qualifies because FTS5 cannot function without it. `body_html` does not — it's never searched and can be parsed from the `.eml` on the rare occasions it's needed. Metadata columns (from, to, subject, date) qualify because they're used in WHERE/ORDER BY/JOIN on nearly every query.

**Consistency:** Email is immutable after receipt. Both the `.eml` file and the SQLite row are written in the same sync operation. There is no update path where they could drift. If the SQLite index is ever suspect, it can be rebuilt from the `.eml` store without touching IMAP.

---

### ADR-020: Sync and Indexing — Concurrent, Single-Threaded, Resilient

**See also:** [SYNC.md](./SYNC.md) — Detailed sync implementation, optimization history, and performance analysis.

**Current implementation:** Sync only. Embedding/indexing and hybrid search have been removed (FTS-first architecture, [OPP-019 archived](opportunities/archive/OPP-019-fts-first-retire-semantic-default.md)). The following describes the prior design; it may be restored or reimplemented later.

**Decision (prior design):** the old CLI exposed separate `ripmail sync` and `ripmail refresh` commands. Both launched sync and indexing concurrently via `Promise.all` in a single thread:

1. **Sync** (bandwidth-bound): IMAP fetch → write `.eml` to maildir → insert into SQLite. Optimized to saturate network bandwidth (ADR-016/017).
2. **Indexing** (removed): Had claimed pending messages from SQLite → generate embeddings via OpenAI → write to LanceDB. Embedding API responses were cached on disk (by model and input hash). Cache lived under `RIPMAIL_HOME/data/embedding-cache`.

```text
ripmail refresh --since <spec>  (backward path)
└── Sync:     IMAP → maildir + SQLite  (bandwidth-bound)
              - Resumes from oldest synced date
              - Uses UID filtering to skip already-synced messages
              - Searches before oldest synced date when all messages from a day are synced

ripmail refresh  (forward path)
└── Sync:     IMAP → maildir + SQLite  (bandwidth-bound)
              - Uses UID range search (UID ${last_uid + 1}:*)
              - Only fetches new messages since last sync
```

**Single-threaded.** Sync runs in one process; embedding/indexing pipeline has been removed ([OPP-019 archived](opportunities/archive/OPP-019-fts-first-retire-semantic-default.md)).

This replaces an earlier multi-worker design that used Bun Workers. That design was abandoned due to SQLite single-writer contention and Bun Worker stability issues. The async-pipelined approach achieves the same throughput for I/O-bound work with a much simpler execution model.

**DB-backed indexing queue (removed).** The prior design tracked indexing per-message via an `embedding_state` column (pending → claimed → done/failed). That column and the indexer have been removed.

**PID-based advisory locks.** Each subsystem has a singleton status row (`sync_summary`, `indexing_status`) with `is_running` and `owner_pid` columns. Sync also stores `sync_lock_started_at` (UTC `datetime('now')` when the lock is taken) for hung-process recovery.

1. Read `is_running`, `owner_pid`, and `sync_lock_started_at` (see `~/lib/process-lock`: `isSyncLockHeld`, `acquireLock`).
2. If locked and `owner_pid` is alive and the lock is younger than **one hour**, exit early — another instance is running (`ripmail refresh` / `runSync` pre-check and background update use the same rule as `acquireLock`).
3. If locked but `owner_pid` is dead, take over the lock (log a warning, reset stale state).
4. If locked, `owner_pid` is alive, but the lock is **older than one hour**, signal the prior owner (`SIGTERM`, then `SIGKILL` after a short wait) and take over the lock.
5. On completion or error, clear `is_running`, `owner_pid`, and `sync_lock_started_at`.

PID checks catch exited/crashed owners immediately. The one-hour cap catches hung syncs (e.g. stuck IMAP) without unbounded blocking. Existing databases gain `sync_lock_started_at` via `ALTER TABLE` on open when the column is missing (no `user_version` bump for this additive column).

**Availability:** Synced messages are immediately available for FTS5 search and direct fetch.

**Search:** FTS5 full-text search only (no hybrid/semantic in current implementation).

**Observability:**

- Sync tracks progress in the DB (`sync_summary`).
- `ripmail status` reports current state.
- Agents and remote clients can poll status at any time without depending on stdout.
- Stdout progress lines are emitted periodically for environments that stream output.

**Ingestion from IMAP:** `ripmail refresh` is the user-facing entry point for fetching mail, with `--since` selecting the backfill path. **Local index rebuild:** `ripmail rebuild-index` wipes SQLite and reindexes from `maildir/cur/` using the same path as a schema version bump (dev/test; no IMAP). Before delete, `sync_state` is read from the old DB and written back after reindex with `last_uid` at least `MAX(uid)` per folder in the rebuilt index so incremental update can resume from UID range instead of a huge date-based search.

---

### ADR-021: Schema Drift Handling — Auto-Rebuild from Maildir

**Decision:** On CLI startup, the app checks `user_version` against the current schema version. If the DB has an older version, the app automatically rebuilds the index from the local maildir cache: reads `sync_state` from the old DB for restore, deletes the DB (plus any `-shm`/`-wal` WAL files), creates a fresh DB, re-indexes all `.eml` files from `maildir/cur/`, then restores `sync_state` (merging with per-folder `MAX(uid)` from the new index). The same path applies to `ripmail rebuild-index`. No manual resync from IMAP is required for the index itself.

**Rationale:** This project intentionally avoids in-app migrations for existing DBs. `CREATE TABLE IF NOT EXISTS` keeps fresh bootstraps simple but does not mutate older tables. The raw maildir is the durable artifact (ADR-002); rebuilding from it is faster than re-syncing from IMAP and avoids credential/network dependency during schema upgrades.

**Sidecar metadata:** EML files lack IMAP-only data (e.g. Gmail labels/categories). During sync, a companion `.meta.json` sidecar is written alongside each `.eml` (same basename, e.g. `100_msg.meta.json`) containing a JSON catch-all for non-standard metadata (`{ "labels": [...] }`). Rebuild reads sidecars to restore label-based noise classification and any future metadata. The sidecar format is extensible — add new fields without creating additional files.

**Result:** Fresh environments bootstrap directly from source schema. Stale local DBs trigger an automatic rebuild from maildir (typically under 20s for moderate mailboxes). If maildir is empty or missing, rebuild completes with 0 messages and the user can run `ripmail refresh --since …` to fetch from IMAP.

**Rebuild throughput (Rust):** Reindex parses `.eml` files in parallel using **OS threads** (`std::thread`, scoped workers; pool size from `available_parallelism` — see `src/rebuild_index.rs`). SQLite writes run on a **single** connection inside bounded transactions. This is intentionally **not** multi-writer SQLite. **Historical Node** used `worker_threads` + optional `RIPMAIL_WORKER_CONCURRENCY` (see git history pre–`node/` removal).

---

---

### ADR-022: CLI Output Format — JSON Default for Structured Commands, Text for Progressive/Content Commands

**Decision:** CLI output format is determined per-command based on whether the output is structured data, progressive status, or raw content — not by TTY detection.

**Format matrix:**

| Command | JSON | Text | Default | Notes |
| --- | --- | --- | --- | --- |
| `search` | yes (`--json`) | yes (`--text`) | **JSON** | Structured results; agent primary workflow |
| `who` | yes (`--json`) | yes (`--text`) | **JSON** | Structured people records |
| `attachment list` | yes (`--json`) | yes (`--text`) | **JSON** | Structured list with IDs agents need to follow up |
| `status` | yes (`--json`) | yes (default) | **text** | Human-readable status lines; agents parse text fine |
| `stats` | yes (`--json`) | yes (default) | **text** | Summary stats; no iteration needed |
| `read` / `message` | no | yes (default) | **text** | Body IS the content; wrapping markdown in JSON adds noise |
| `thread` | no | yes (default) | **text** | Same as `read` — multi-message view; was previously always JSON (changed) |
| `update` | no | yes (default) | **text** | Progressive output as update runs; JSON would be worse |
| `attachment read` | no | yes (default) | **text** | Raw content / extracted text; wrapping in JSON is clumsy |

**Key principles driving these decisions:**

1. **Machine-parsable by default** for commands whose output agents need to consume structurally (search results, people records, attachment lists). JSON is the format.
2. **Token-efficient** — JSON is not imposed where it adds wrapper noise without value (e.g. a markdown email body inside a JSON string field).
3. **Self-documenting** — hints and guidance remain in output (in the JSON payload for JSON commands; in stdout for text commands) so agents learn as they go.
4. **No TTY detection** for format switching. TTY detection is fragile and creates inconsistency between interactive and scripted use. Format defaults are fixed per command; users/agents opt out with `--text` or `--json`.

**Flag naming — `--text` not `--table`:**

The override flag is `--text` (not `--table`) because several text-format commands (`status`, `sync`) don't produce tables — they produce status lines. `--text` is the general term for human-readable non-JSON output.

**`thread` change — text by default:**

`thread` was previously hardcoded to always output JSON. This is changed to match `read`/`message`: text by default. The body content of emails is the value, and wrapping markdown bodies in JSON strings offers no agent benefit over a readable multi-message text view. If an agent needs to iterate over message IDs from a thread, it can use `search` with a thread filter.

**`status` and `stats` — text default with `--json` opt-in:**

Agents today parse the text output of `status` without difficulty. Text stays the default. `--json` is added as an opt-in for automated status checks (e.g. "is sync done?" polling).

**Rationale:** ripmail is agent-first (ADR-005). The primary consumers are agents (Claude Code, Cursor, etc.) running CLI commands as subprocesses. Agents need structured output for search results and lists they'll iterate or pass downstream — JSON is correct there. For content retrieval (`read`, `thread`, `attachment read`) and progress reporting (`sync`, `refresh`, `status`), text is not a barrier to agent use and avoids JSON encoding overhead on large content.

---

### ADR-023: SQLite Access — File-Backed Native + Async Facade + ABI Recovery

**Primary implementation (Rust):** **`rusqlite`** with the **`bundled`** feature — embedded SQLite, no separate native-addon ABI story for end users.

**Historical Node implementation:** **file-backed** SQLite using **`better-sqlite3`** (native addon). The remainder of this ADR describes that stack and **ABI recovery** for **`npm install -g @cirne/zmail`**; it remains relevant for anyone inspecting old releases or the published npm tarball.

**Decision (Node era):** Keep **file-backed** SQLite using **`better-sqlite3`** (native addon). Do **not** use an in-process model that loads the entire database file into JS/WASM heap for production (e.g. sql.js `readFile` → `Database(uint8)` / `export()` persistence), which would make RSS scale with DB size — unacceptable for very large mailstores.

**Application API:** Expose a narrow **`SqliteDatabase`** interface (`exec`, `prepare` → async `run` / `get` / `all`, `close`) implemented by a small adapter around `better-sqlite3`. All CLI, sync, search, and ask code paths **`await`** DB operations so the surface is consistently async even though the underlying driver is synchronous.

**Packaging / ABI:** There is **no** `postinstall` rebuild. **`better-sqlite3`’s** own install may supply a matching prebuild; if loading fails with a **`NODE_MODULE_VERSION`** / ABI mismatch (common after **`npm install -g`** or switching Node), **`ensure-better-sqlite-native`** (imported before **`better-sqlite3`**) runs **`npm rebuild better-sqlite3`** from the **`@cirne/zmail`** install directory and retries. Set **`RIPMAIL_SKIP_NATIVE_SQLITE_ENSURE=1`** to skip (e.g. constrained environments). **Repo dev:** **`.npmrc`** **`engine-strict=true`** enforces **`package.json` `engines`**. Manual fallback when recovery fails: run **`npm rebuild better-sqlite3`** with the same `node` that runs `ripmail`.

**Global install vs `overrides`:** For **`npm install -g`**, npm’s install root is the global prefix, so **`overrides` in `@cirne/zmail/package.json` are not applied** to the dependency tree the way they are in a repo-root install. **`bundledDependencies`** (the **`exceljs`** stack) ships the maintainer’s resolved **`node_modules` subtrees** in the published tarball so global installs pick up the same pinned/override-resolved versions. Remaining install noise is mostly **`prebuild-install`** (from **`better-sqlite3`**) until that chain changes upstream.

**Schema changes:** Unchanged philosophy (ADR-021): bump **`SCHEMA_VERSION`**, delete stale DB files, **rebuild from maildir** — no row-level migration from old DB files when the driver or schema changes.

**Deferred:** WASM SQLite with a custom file VFS for Node remains an alternative if native rebuild stops being sufficient; FTS5 and file-backed behavior would need to be re-validated before switching.

**See also:** [OPP-024](opportunities/archive/OPP-024-sqlite-node-abi-mitigation.md) — opportunity log for the ABI / global-install mitigation.

---

### ADR-024: Outbound Email — SMTP Send-as-User + Local Drafts

**Decision:** Outbound mail uses **SMTP submission** with the **same identity and password as IMAP** (provider mailbox, not Mailgun/SendGrid by default). Infer `smtp.host` / port / TLS from `imap.host` with optional `smtp` overrides in `config.json` (see `resolve_smtp_settings` in `src/config.rs`, `src/send/smtp_resolve.rs`). Implementation uses **`lettre`** (Rust).

**Dev/test safety (optional):** Set **`RIPMAIL_SEND_TEST=1`** to restrict SMTP sends to **`lewiscirne+ripmail@gmail.com`** (enforced in `src/send/recipients.rs`). Default is unrestricted recipients.

**Drafts:** Pre-send content lives as **Markdown + YAML frontmatter** under `{dataDir}/drafts/`; after send, the draft file is moved to `{dataDir}/sent/`. Local drafts are **not** synced to the provider’s IMAP Drafts folder in v1. **CLI:** `ripmail draft new|reply|forward|list|view`, **`ripmail draft edit <id> "<instruction>"`** (LLM revision via OpenAI), **`ripmail draft rewrite <id> …`** (literal body), then **`ripmail send <draft-id>`**. Mutating commands default to JSON; **`--text`** prints a human-readable draft.

**Threading:** `In-Reply-To` / `References` for replies are built from the source message’s raw `.eml` via **`mail_parser`** (`src/send/threading.rs`), because those headers are not stored as columns in SQLite.

**Non-goals (v1):** OAuth2-only SMTP, per-message relay APIs, IMAP APPEND to Drafts.

**See also:** [OPP-011 archived](opportunities/archive/OPP-011-send-email.md).

---

### ADR-025: Rust Port — Primary Implementation

**Decision:** The **only** in-repo implementation is **Rust** at the **repository root** (`Cargo.toml`, `src/`, `tests/`). It implements the **agent contract**: `RIPMAIL_HOME` / `~/.ripmail` (`config.json`, `.env`, `data/`, maildir layout), FTS5 SQLite schema semantics, and CLI subcommands. **`/target/`** at the repo root is gitignored; CI runs **`cargo test`** from the **repository root**. **Historical:** TypeScript under **`node/`** was maintained in parallel until cutover; that tree is **removed** — compare via git history if needed.

**Stack:** `clap` CLI, **`rusqlite`** with the **`bundled`** feature (embedded SQLite; contrast ADR-023 Node-era **better-sqlite3**), **`imap`** (TLS IMAP client) for `ripmail refresh` paths, `mail-parser`, attachment extractors (PDF, DOCX, XLSX, HTML, CSV, TXT), integration tests in **`tests/*.rs`** by area.

**Checkpoint (in-repo):** Integration tests under **`tests/`** plus `#[cfg(test)]` unit tests in **`src/`** run via **`cargo test`** — not a substitute for production bakeoffs on real mailboxes.

**Tracker:** **[RUST_PORT.md](RUST_PORT.md)** — future work, intentional differences vs historical Node, risks, production validation; [OPP-030 archived](opportunities/archive/OPP-030-rust-port-cutover.md). **CI:** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`.github/workflows/release-builds.yml`](../.github/workflows/release-builds.yml). **Releases:** [RELEASING.md](RELEASING.md).

**Rationale:** Single binary, no Node native-addon ABI class of failures ([OPP-024 archive](opportunities/archive/OPP-024-sqlite-node-abi-mitigation.md)), predictable SQLite embedding.

---

### ADR-026: SQLite Concurrency — Reads vs Writes, Lazy Open, Avoiding Lock Contention

**Context:** ripmail uses **one** file-backed database (`data/ripmail.db`) with **WAL** (`journal_mode=WAL`) and a **busy timeout** (Rust: `busy_timeout` in [`src/db/mod.rs`](../src/db/mod.rs)). Multiple **processes** (CLI subprocesses, background sync) may open the DB at the same time. A recurring bug pattern is **opening SQLite when the code path does not need the index** — e.g. purely local draft file work — so the subprocess blocks on `open` / first pragma / schema touch while another process holds a **write** lock (long sync transaction). That surfaces as “hang with no output until killed” ([BUG-030 archived](bugs/archive/BUG-030-draft-commands-hang-after-edit.md)).

**Decision — how to think about concurrency:**

1. **Readers (many, across processes):** Under WAL, **multiple concurrent readers** are normal and expected. Search, read, status, and other **read-mostly** paths may open a connection and run queries without coordinating with each other. Prefer **short** transactions and avoid holding a connection open across unrelated I/O (network, LLM).

2. **Writers (few, serialized):** SQLite allows **one writer at a time** for a given database file. **Sync** and **indexing** are the heavy writers. Treat writes as **critical sections**: keep transactions bounded; do not interleave long IMAP waits inside a write transaction where avoidable. **Sync** additionally uses a **PID-based advisory lock** in `sync_summary` ([ADR-020](#adr-020-sync-and-indexing--concurrent-single-threaded-resilient)) so only one sync run “owns” the pipeline — that does not remove SQLite’s writer mutex, but it prevents duplicate sync processes from hammering the DB.

3. **Lazy open (agent-first CLI):** **Do not** call `open_file` / equivalent at the top of a command unless **every** branch of that command needs the index. Open the DB **inside** the subcommand or branch that runs SQL. Examples: `ripmail draft list|view|edit` only touch `data/drafts/`; **`ripmail send <draft-id>`** for a **forward** draft does not need threading from SQLite — open only when loading reply threading from the index. This reduces **unnecessary** `busy` waits and makes local-only workflows reliable while sync runs.

4. **When in doubt:** If a new feature **could** work from maildir or draft files alone, **don’t** add a DB dependency until there is a clear query need. If it **must** write, reuse existing lock/transaction patterns and document any new long-running writer.

**Writable `open_file` busy retry:** [`open_file`](../src/db/mod.rs) (read-write, schema, optional rebuild) **retries up to 3 times** with **1 second** between attempts when SQLite returns `SQLITE_BUSY` or `SQLITE_LOCKED` during that open path. Do not add ad-hoc sleeps at other `open_file` call sites.

**SQLite read vs write operations:** Use **read-only** opens ([`open_file_readonly`](../src/db/mod.rs) / [`open_file_for_queries`](../src/db/mod.rs)) for query-only code paths so those processes do not take a write-capable handle. **Read-only** is only valid when the database file **already exists**; the first materialization of the index still uses `open_file` (create + schema).

| Area | Command / entry | Connection | Why |
| --- | --- | --- | --- |
| DB bootstrap | `open_file`, `maybe_rebuild_stale_db`, migrations | **RW** | Create file, `journal_mode=WAL`, `user_version`, schema DDL, rebuild |
| Sync / index | `sync`, `refresh`, rebuild, background sync, IMAP / Apple Mail / local dir / calendar **sync** | **RW** | Inserts/updates `messages`, FTS, `sync_state`, attachments, calendar, locks |
| Inbox | `inbox` / `run_inbox_scan` | **RW** | Rule triage on `messages`, `inbox_decisions`, `is_archived`, `inbox_scans` / alerts |
| Archive | `archive` | **RW** | `archive_messages_locally` and provider flow |
| Rules | `rules` add/edit/move/reset (mutations) | **RW** when code touches the index | File writes; any DB path that mutates or full rule assign |
| Attachments | `attachment` with text cache or legacy `stored_path` backfill | **RW** | `UPDATE attachments` |
| Send | `send` (threading from index) | **RO** | `SELECT` only |
| Mail queries | `search`, `read`, `thread`, `who`, `whoami` | **RO** when DB exists | Queries only |
| Status | `status` | **RO** when DB exists | Reads `sync_summary`, locks, counts |
| Calendar | `calendar` query commands | **RO** when DB exists | Reads indexed events |
| Ask | `ask` | **RO** when DB exists | Search/read tools |
| Rules | `rules validate --sample`, rule impact **preview** | **RO** when DB exists | Counts / preview without `run_inbox_scan` persist |
| Wizard / setup | First-time DB open | **RW** | Schema / layout |

**Not a separate pool:** SQLite is not Postgres — there are no distinct “read replicas.” “Many read connections” here means **many processes or short-lived connections issuing read transactions** against the same WAL-backed file, which is the supported pattern. **Write** paths remain **single-writer-at-a-time**; coordination beyond that is **application-level** (sync PID lock, short transactions).

**See also:** [ADR-020](#adr-020-sync-and-indexing--concurrent-single-threaded-resilient), [ADR-023](#adr-023-sqlite-access--file-backed-native--async-facade--abi-recovery), [ADR-024](#adr-024-outbound-email--smtp-send-as-user--local-drafts) (drafts vs index).

---

### ADR-027: Stateful Inbox — No Daemon, Soft State on Schema Bump

**Decision:** Inbox scan state (which messages have been surfaced, scan history) is persisted in SQLite without introducing a long-running daemon process. Scan state is treated as **soft state** — lost on schema-bump rebuilds and re-derived from the next scan.

**Related:** [OPP-032](opportunities/OPP-032-llm-rules-engine.md) (stateful inbox, rules, archive), [ADR-002](#adr-002-storage--embedded--persistent-volume-throughout) (rebuildable index), [ADR-021](#adr-021-schema-drift-handling--auto-rebuild-from-maildir) (auto-rebuild from maildir)

#### Part 1: No daemon — state without a persistent process

**Context:** A `ripmail daemon` would own the refresh cycle, maintain scan state, accept feedback, learn over time, and push notifications proactively. This is the natural architecture for a self-sufficient notification system.

**Decision:** Do not introduce a daemon. Add scan state to SQLite (`inbox_alerts`, `inbox_reviews`, `inbox_scans`, `inbox_handled`) so inbox scan passes (e.g. `ripmail inbox`) can deduplicate surfaced messages across invocations.

**Tradeoffs considered:**

*Daemon pros:* Self-contained reliability (ripmail owns its refresh cycle, not coupled to agent harness reliability). Persistent state is trivial when the process is persistent. Natural home for feedback and learning. Decouples from agent harness uptime.

*Daemon cons:* Daemon lifecycle is significant engineering tax (start/stop/restart, crash recovery, PID files, launchd/systemd integration). Creates parallel state alongside SQLite — risk of split brain, unclear reset semantics. Overlaps with the agent harness (OpenClaw, Claude Code), which is already a daemon-like scheduler. Pushes ripmail toward being an email client rather than an intelligence layer ([STRATEGY.md](../../docs/STRATEGY.md)). LLM cost on a schedule regardless of listeners. Notification transport is an open question (file? webhook? desktop notification?) that couples the daemon to infrastructure.

*Why no daemon wins:* Most daemon benefits come from persistent state, not a persistent process. SQLite tables provide persistent state. The calling agent can schedule `ripmail refresh` and `ripmail inbox` on a loop without ripmail owning a long-lived process. The full daemon is deferred until later phases are validated and prove insufficient.

#### Part 2: Soft state — lose scan state on schema bump

**Context:** `inbox_alerts`, `inbox_reviews`, `inbox_handled`, and `inbox_scans` contain non-rebuildable state (cannot be reconstructed from `.eml` files). This breaks the ADR-002/ADR-021 contract that SQLite is a rebuildable cache.

**Decision:** Accept that schema-bump rebuilds lose surfaced state. The consequence is one round of re-surfaced (duplicate) emails after an upgrade, after which the new surfaced set is established and dedup resumes.

**Three options considered:**

| Option | Description | Complexity | Downside |
| --- | --- | --- | --- |
| **(a) Full migrations** | `ALTER TABLE` scripts keyed to `user_version` | High — migration files, maintenance, changes dev experience | Contradicts "no migrations" rule; large step from current simplicity |
| **(b) Export/reimport** | Read non-rebuildable rows from old DB before rebuild, reinsert after | Medium — extends existing `sync_state` preservation pattern | Preserved tables must have stable schemas or transforms are needed (migrations by another name) |
| **(c) Lose state** | Schema bump resets surfaced set and scan history | None | One-time re-notification after upgrade |

**Why (c) wins for now:** Schema bumps are infrequent (11 versions over the project's life). One-time re-notification after upgrade is minor UX friction, not trust-breaking. User rules (`~/.ripmail/rules.json`) survive rebuilds regardless (they're files, not in SQLite), so learned preferences persist. Only "which specific messages have I already shown you" resets. Upgrade to (b) if re-notification proves painful (e.g. 50+ duplicates after each upgrade).

---

### ADR-028: Deterministic Inbox — Search-Query Rules, No LLM Triage

**Decision:** `ripmail inbox` classifies messages using **only** **`kind: "search"`** rules in **`~/.ripmail/rules.json`** (version **3** — one **`query` string per rule, same semantics as `ripmail search`**) plus a documented **non-LLM fallback** for candidates that match no rule. It does **not** call OpenAI or any remote model. **OpenAI** remains for **`ripmail ask`**, **`ripmail draft edit`**, setup/wizard validation, and similar features.

**Rationale:** Inbox triage must be **predictable**, **offline-capable**, and **cheap** at scale. Rule predicates reuse the **same** parsed query → SQLite **`WHERE`** / FTS **`MATCH`** path as **`ripmail search`** (no parallel regex matcher). Optional **`context`** entries in `rules.json` are **for agents** (documentation / future use); the classifier ignores them for matching.

**Rules file:** On first use or setup, a **bundled default** rules pack (**`default_rules.v3.json`**) is written if `rules.json` is missing. **`ripmail rules validate`** checks schema and query compile; optional **`--sample`** runs counts against the open DB. **`rules_fingerprint`** hashes the **`rules` array in file order** (and sorted **context** for stable cache invalidation). **Precedence** is **list order** with **short-circuit**: `messages.rule_triage` starts **`pending`**; each rule applies the shared search predicate only to rows still **`pending`**, then sets **`assigned`** + **`winning_rule_id`** — earlier rules claim messages before later rules run.

**JSON contract:** Rows expose **`decisionSource`** (`rule`, `fallback`, etc.), **`matchedRuleIds`**, and **`winningRuleId`** when applicable. **`requiresUserAction` / `actionSummary`:** v1 deterministic inbox leaves them **false** / empty unless extended later; columns remain for forward compatibility and cached rows.

**See also:** [OPP-038 archived](opportunities/archive/OPP-038-inbox-rules-as-search-language.md), [OPP-037 archived](opportunities/archive/OPP-037-typed-inbox-rules-eval-style.md) (superseded regex-only shape), [ADR-027](#adr-027-stateful-inbox--no-daemon-soft-state-on-schema-bump), [`skills/ripmail/references/INBOX-CUSTOMIZATION.md`](../skills/ripmail/references/INBOX-CUSTOMIZATION.md).

---

### ADR-029: Local Gateway — One Binary, Multiple Corpora (Mail, Calendar, …)

**Context:** ripmail began as **mail → SQLite → CLI**. The product direction is a **single native CLI** (`ripmail`) that stays **agent-first**: shared **config**, **`RIPMAIL_HOME`**, logging, and sync orchestration, with **additional subcommands** for non-mail corpora that fit the same pattern (indexed rows, `refresh`, `--source` / `-S`, `--json`).

**Decision:**

1. **Expand in place** — Add modules and command groups (e.g. `calendar`) rather than new top-level binaries. Optional **compile-time features** may omit heavy connectors later; the default remains **one** shipped executable per platform build.

2. **Normalized storage per domain** — Each corpus gets appropriate tables (e.g. calendar events are **not** forced into the mail message schema). **ICS** is a supported **ingest** format (subscriptions, exports) but **calendar scheduling** and **stable identity** target the **SQLite model**, not ICS alone.

3. **macOS native APIs** — Frameworks such as **EventKit** require a **native** code path (Rust via `objc2`, a small Swift helper subprocess, or one blessed helper). **Permissions** attach to that executable’s identity (`Info.plist` usage strings, TCC); avoid scattering one-off untracked helpers.

4. **Rename / positioning** — Treat **“ripmail”** as the working name. Renaming the binary or user-facing strings for a broader “local gateway” story is **deferred** (marketing and packaging, not a blocker).

5. **Longer horizon** — The same pattern may cover **notes**, **contacts**, and other system-backed resources sketched in unified-sources opps; each adds subcommands + schema slices, not parallel CLIs.

**Brain-app (host) alignment:** The intended integration is **subprocess** to this CLI with **`RIPMAIL_HOME`** pointing at the Brain ripmail directory. **Exception:** Apple **Messages** / **`chat.db`** — documented in **brain-app** [integrations.md](../../docs/architecture/integrations.md#trust-boundaries-ripmail-vs-direct-sqlite-access) (read-only SQLite in Node; different permission surface). Do **not** treat **chat.db** as the template for calendar, contacts, or EventKit-backed data.

**Related work:** [OPP-053](opportunities/archive/OPP-053-local-gateway-calendar-and-beyond.md) (calendar read path + Phase B scheduling), [OPP-087](../../../docs/opportunities/OPP-087-unified-sources-mail-local-files-future-connectors.md) (unified `sources` / `refresh`).

---

### ADR-030: File Source Indexing — Contentless FTS5, No Local Content Copy

**Context:** As ripmail expands from mail-only to a unified sources model ([OPP-087](../../../docs/opportunities/OPP-087-unified-sources-mail-local-files-future-connectors.md)), it indexes `localDir` paths and will index cloud file sources (lead: Google Drive — [brain-app OPP-045](../../docs/opportunities/OPP-045-google-drive.md)). The current schema stores full extracted text in two places for each indexed document: `files.body_text` and `document_index.body`. For mail, both copies are load-bearing (the body is served via `ripmail read <message-id>` without a network call). For files, the original always exists on disk or is re-fetchable from a cloud API — local copies are redundant and cause the DB to grow proportionally with the user's file tree.

**Decision:**

1. **Split the FTS tables by corpus kind.** Do not extend the existing mail FTS setup (`document_index_fts` with `content='document_index'`) to cover files. Instead, introduce a separate `files_fts` virtual table for file-kind sources.

2. **`files_fts` uses contentless FTS5** (`content=''`). SQLite stores only the token/position index — not the original document text. This provides full `MATCH` query support and `bm25()` ranking at roughly 20–40% the size of the raw text, rather than 200%+ (two full copies + index). The trade-off: `snippet()` and `highlight()` are unavailable (they require stored content). This is acceptable; the agent's goal at search time is identifying the right document path, not extracting a character-level match. The agent calls `read_doc` for full content.

3. **`files` table stores metadata + excerpt only.** `title`, `path`, `mtime`, `size`, `mime`, and an `excerpt` (~500 chars) for search-result display. No `body_text` column. At index time the full extracted text is fed into `files_fts` for tokenization, then discarded from SQLite.

4. **Mail keeps its current external-content setup.** `document_index` continues to store `body` for mail entries; `document_index_fts` continues to use `content='document_index'`. No change to mail indexing behavior.

5. **Read-time content retrieval is on-demand.** `ripmail read <path>` reads live from disk for `localDir` sources. For cloud sources, it re-downloads via the provider API with a short-TTL cache under `RIPMAIL_HOME/<source-id>/cache/` keyed by path hash + mtime. Plain text/markdown is zero-cost; conversion-heavy formats (PDF, DOCX) are cached on first access.

6. **This is a clean-slate schema change.** SCHEMA_VERSION bump; `ripmail rebuild-index` re-crawls from sources. No migration path required per [early-development norms](../AGENTS.md#early-development-no-user-base-clean-breaks).

**Rationale:** The 50 ms vs 1–2 s search latency difference between local FTS5 and live cloud API calls is non-negotiable for agent UX (agent turns involve multiple search calls). The contentless FTS5 approach preserves that speed while eliminating the content-duplication growth problem. Vector/embedding search was considered and deferred: embedding generation requires a model dependency (local) or API calls with privacy tradeoffs (cloud), the index size is comparable to or larger than FTS5 for the same corpus, and the agent can compensate for FTS recall gaps by reformulating keyword queries across turns.

**Related:** [OPP-087](../../../docs/opportunities/OPP-087-unified-sources-mail-local-files-future-connectors.md) (storage and indexing section), [brain-app OPP-045](../../docs/opportunities/OPP-045-google-drive.md) (Google Drive milestone), [external-data-sources.md](../../docs/architecture/external-data-sources.md) (unified external-source architecture).

---

## Open Questions

- **npm deprecation:** If **`@cirne/zmail`** remains on the npm registry, maintainers may deprecate it in favor of **`install.sh`** / GitHub Releases ([RUST_PORT.md](RUST_PORT.md), [OPP-030 archived](opportunities/archive/OPP-030-rust-port-cutover.md)).
