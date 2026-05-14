# Chat history: SQLite

**Status:** **Implemented** — sessions and messages live in **`var/brain-tenant.sqlite`** per tenant (`files.tenantSqlite` in [`brain-layout.json`](../../shared/brain-layout.json), helper [`brainLayoutTenantSqlitePath`](../../src/server/lib/platform/brainLayout.ts)). The **mail index** (FTS, sync state, drafts, etc.) lives in the tenant **`ripmail/`** tree (see layout keys in `brain-layout.json`), opened in-process by **`src/server/ripmail/`**. **Merging** that mail database into the same SQLite file as chat + notifications is **[OPP-108](../opportunities/OPP-108-unified-tenant-sqlite.md)** ([archived **OPP-103**](../opportunities/archive/OPP-103-ripmail-ts-port.md) — in-process TypeScript mail runtime).

**Previous store:** JSON files under `$BRAIN_HOME/chats/` (removed — clean break per [AGENTS.md](../../AGENTS.md)).

**Module boundary:** [`chatStorage.ts`](../../src/server/lib/chat/chatStorage.ts) persists via [`getTenantDb`](../../src/server/lib/tenant/tenantSqlite.ts); routes and agents unchanged.

---

## Current implementation

- **`chat_sessions`** — `session_id`, `title`, `preview`, `created_at_ms`, `updated_at_ms`
- **`chat_messages`** — `session_id`, `seq`, `role`, `content_json` (JSON matching [`ChatMessage`](../../src/server/lib/chat/chatTypes.ts)), `created_at_ms`
- **`notifications`** — app + mirrored mail-brief rows (`source_kind`, `payload_json`, `state`, optional `idempotency_key`) — shipped **[archived OPP-102](../opportunities/archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md)**

Schema version is **`TENANT_SCHEMA_VERSION`** in [`tenantSqlite.ts`](../../src/server/lib/tenant/tenantSqlite.ts); mismatch **deletes and recreates** the DB file (no migrations).

The tenant DB opens with **`journal_mode = WAL`** (same module). WAL improves **read** concurrency with writers versus the default rollback journal; SQLite still allows **only one writer at a time** per database file, so concurrent commits for the **same** tenant queue behind that lock.

FTS5 over titles/previews is **not** enabled yet (optional follow-on); listing uses `updated_at_ms DESC`.

---

## Concurrency, B2B chat, and why tenant SQLite is enough (for now)

- **Per-tenant file, not one global chat DB.** Chat sessions and messages for a workspace live in **that tenant’s** `brain-tenant.sqlite`. Hosted multi-tenant traffic spreads writes across **many files**; different tenants do not contend on the same SQLite database.
- **Brain-to-brain / B2B.** Each side persists its own view under its own tenant home; there is still **no** shared central SQLite for all participants’ chat rows.
- **Where pressure shows up first.** The limiting case is **one very hot tenant** (many parallel sessions or commits touching the **same** file), not “lots of messages worldwide” spread across workspaces.
- **Process note.** The server uses **better-sqlite3** with a **cached connection per tenant DB path** ([`getTenantDb`](../../src/server/lib/tenant/tenantSqlite.ts)); bursts of work for a given tenant still serialize commits at the database.

Together with WAL, this is why we are **comfortable staying on SQLite** for chat and related app metadata in the short and medium term without reaching for a server RDBMS.

---

## B2B cross-tenant writes and cell scaling

**Product flow** (cold query, review queue, approve-to-send, paired sessions) is documented in **[braintunnel-b2b-chat.md](./braintunnel-b2b-chat.md)**. This section focuses on **persistence** and **scaling**.

**Today.** Brain-to-brain / tunnel flows do **not** only touch the signed-in user’s SQLite. The server validates grants (and related rules), then uses **`runWithTenantContextAsync`** to switch [`AsyncLocalStorage`](../../src/server/lib/tenant/tenantContext.ts) to the **peer tenant’s** home and performs normal chat/notifications persistence there — e.g. **`runB2BQueryForGrant`** and **`POST /cold-query`** in [`b2bChat.ts`](../../src/server/routes/b2bChat.ts). Helper **[`createNotificationForTenant`](../../src/server/lib/notifications/createNotificationForTenant.ts)** exists precisely because the HTTP actor and notification recipient can differ. **Grant rows** live in **global** SQLite (`brain_query_grants`), while **chat rows stay per tenant**.

**Authorization.** Safety is **trusted server + capability checks** (grant owner/asker, inbound session ownership, cold-query limits), not “only the owning user’s browser session may open this DB.” End users never get direct filesystem access to peer SQLite files.

**Why this conflicts with strict cell isolation.** Phase 2+ hosted design (**one active tenant per container**, container-local disk — see **[multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)**) assumes a request’s work stays on **one** machine where that tenant’s directory is mounted. A single asker-initiated B2B request currently needs **both** tenants’ homes on the **same** Node process (or equivalent shared volume), because it **sequentially impersonates** each tenant context and opens each **`brain-tenant.sqlite`**.

**Recorded gap — address when tackling tenant-cell horizontal scaling.** When we implement **tenant-stickied routing** and **exclusive per-container tenant storage** without a shared filesystem across arbitrary pairs, **today’s in-process cross-tenant writes must be redesigned.** Moving chat to Postgres does **not** remove this problem by itself; the core issue is **which runtime may mutate which tenant’s store**.

**Preferred direction (hypothesis, not implemented).** Prefer **HTTP from the app to itself** over introducing a **dedicated global cross-container message queue** as the default: an **internal** API (service auth — HMAC, mutual TLS, or equivalent TBD) where the asker’s handler issues a **tenant-targeted** HTTP call; the **load balancer or ingress** routes that request to the **container that holds the peer tenant’s lease**, which applies the inbound write and runs owner-side work locally. The initiator path might **not synchronously await** the full pipeline (e.g. fire-and-forget or poll); exact **SSE/UI** behavior is **TBD** when this work is scheduled.

**Related:** [multi-tenant-cloud-architecture.md § Cross-tenant B2B and cell locality](./multi-tenant-cloud-architecture.md#cross-tenant-b2b-and-cell-locality).

---

## Postgres: deferred (no near-term plans)

We are **not planning to adopt Postgres** for chat history, notifications, or brain-to-brain metadata in the **foreseeable future**. That could be revisited only if constraints change in ways we do not currently expect—for example: many **stateless** app instances **sharing one tenant’s** mutable chat state without colocated disk; **mandatory** HA/replication or operational requirements at the SQL layer; sustained **measured** writer contention **per tenant** that SQLite cannot meet; or a product need for **cross-tenant** relational analytics over live chat tables (more likely via ETL or a warehouse than Postgres).

**Recorded commitment:** Keep **per-tenant SQLite + WAL** as the persistence architecture for this slice until something above forces a rethink.

---

## Roadmap: one SQLite per tenant (RipMail + app DB)

Today the **mail index** (FTS, sync state, drafts, etc.) lives in **separate** SQLite under each tenant’s **`ripmail/`** tree, while chat + notifications live in **`var/brain-tenant.sqlite`**. **Consolidating** those into **a single SQLite file per tenant** (mail + chat + notifications) remains on the roadmap — **[OPP-108](../opportunities/OPP-108-unified-tenant-sqlite.md)**. That merge is about **operational simplicity and one backup/checkpoint surface per workspace**, **not** a move to Postgres.

---

## Historical limits of the JSON-era design (why SQLite)

Directory scans + parsing every session file broke down past ~200–300 sessions; there was no FTS or server-side pagination beyond a fixed cap.

---

## Rough schema reference (actual DDL uses `chat_` table prefixes)

```sql
CREATE TABLE chat_sessions (
  session_id  TEXT PRIMARY KEY,
  title       TEXT,
  preview     TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE chat_messages (
  session_id  TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at_ms DESC);
```

Optional future FTS:

```sql
CREATE VIRTUAL TABLE chat_sessions_fts USING fts5(session_id UNINDEXED, title, preview);
```

---

## What stays as files

- **Wiki** — content, not app state; files are the right model.
- **Skills** — user-editable markdown, intentionally inspectable on disk.
- **`chats/onboarding/`** — onboarding machine JSON adjuncts still live under the chats directory tree (`chatDataDir()`).

---

*Back: [README.md](./README.md)*
