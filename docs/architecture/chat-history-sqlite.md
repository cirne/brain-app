# Chat history: SQLite

**Status:** **Implemented** — sessions and messages live in **`var/brain-tenant.sqlite`** per tenant (`files.tenantSqlite` in [`brain-layout.json`](../../shared/brain-layout.json), helper [`brainLayoutTenantSqlitePath`](../../src/server/lib/platform/brainLayout.ts)). Ripmail’s index remains under **`ripmail/`** until [OPP-103](../opportunities/OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md) merges mail into the same file.

**Previous store:** JSON files under `$BRAIN_HOME/chats/` (removed — clean break per [AGENTS.md](../../AGENTS.md)).

**Module boundary:** [`chatStorage.ts`](../../src/server/lib/chat/chatStorage.ts) persists via [`getTenantDb`](../../src/server/lib/tenant/tenantSqlite.ts); routes and agents unchanged.

---

## Current implementation

- **`chat_sessions`** — `session_id`, `title`, `preview`, `created_at_ms`, `updated_at_ms`
- **`chat_messages`** — `session_id`, `seq`, `role`, `content_json` (JSON matching [`ChatMessage`](../../src/server/lib/chat/chatTypes.ts)), `created_at_ms`
- **`notifications`** — app + mirrored mail-brief rows (`source_kind`, `payload_json`, `state`, optional `idempotency_key`) — shipped **[OPP-102 stub](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** · [archive](../opportunities/archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md)

Schema version is **`TENANT_SCHEMA_VERSION`** in [`tenantSqlite.ts`](../../src/server/lib/tenant/tenantSqlite.ts); mismatch **deletes and recreates** the DB file (no migrations).

FTS5 over titles/previews is **not** enabled yet (optional follow-on); listing uses `updated_at_ms DESC`.

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
