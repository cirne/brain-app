# Chat history: move to SQLite

**Status:** Tracked as **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** — chat tables will live in the **tenant app SQLite** (single DB with notifications and shared schema lifecycle), not a standalone `chats.db` effort in isolation.

**Current store:** JSON files under `$BRAIN_HOME/chats/` (per tenant in hosted mode).

---

## Current design and its limits

Each chat session is a JSON file named `{createdAtMs}-{uuid}.json` under `$BRAIN_HOME/chats/`. `GET /api/chat/sessions` lists the directory, parses every file, sorts by filename timestamp, and returns up to 500 rows. The browser filters that array in-memory; there is no server-side search or pagination.

This works fine at < 100 sessions. It becomes visibly slow and functionally incomplete beyond that:

- **Perf cliff** around 200–300 sessions — directory scan + JSON parse for every list view.
- **No full-text search** across chat history. "Which session mentioned the BICF grant?" requires scanning every file.
- **No pagination** server-side — the 500-row cap is a ceiling, not a cursor.
- **Title prefix search** for URL routing already does an O(n) scan of the list as a workaround.

The architecture doc acknowledges this in [agent-chat.md](./agent-chat.md).

---

## Target design

Implemented under **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** as part of a **single per-tenant Brain app SQLite** (not necessarily named `chats.db`; path will live in `brain-layout` + helpers). **Rough** session/message schema:

Rough schema:

```sql
CREATE TABLE sessions (
  session_id  TEXT PRIMARY KEY,
  title       TEXT,
  created_at  INTEGER NOT NULL,   -- unix ms
  updated_at  INTEGER NOT NULL,
  preview     TEXT                -- first user message snippet
);

CREATE TABLE messages (
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL,      -- 'user' | 'assistant' | 'tool_result'
  content     TEXT NOT NULL,      -- JSON blob matching current ChatMessage shape
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX sessions_updated ON sessions(updated_at DESC);
CREATE VIRTUAL TABLE sessions_fts USING fts5(session_id UNINDEXED, title, preview);
```

`chatStorage.ts` is the only place to change. The rest of the codebase (routes, agent hydration) calls into that module.

---

## Why now

- **Zero migration burden** — early development; no user data to preserve. Clean break per [AGENTS.md](../../AGENTS.md).
- **Schema is already stable** — `sessionId`, `title`, `createdAt`, `updatedAt`, `messages[]` has not meaningfully changed.
- **Unlocks search** — FTS5 over titles and preview text enables "find my chat about X" as a feature.
- **Nav recents** (`navRecentsStore.ts`) and **preferences** (`onboardingPreferences.ts`) are natural follow-on tables in the same DB — see [preferences-store.md](./preferences-store.md).

The cost is roughly a half-day: replace `chatStorage.ts`, update tests, drop the JSON file format.

---

## What stays as files

- **Wiki** — content, not app state; files are the right model.
- **Skills** — user-editable markdown, intentionally inspectable on disk.
- **Ripmail SQLite** — separate domain (`RIPMAIL_HOME`), owned by the Rust binary.

---

*Back: [README.md](./README.md)*