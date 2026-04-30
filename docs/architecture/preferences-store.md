# Preferences store: consolidation

**Status:** Not yet consolidated — preferences are currently split across five separate stores.

---

## Current state

"User preferences" are scattered:

| Store | Path / mechanism | Examples |
|-------|-----------------|---------|
| `preferences.json` | `$BRAIN_HOME/chats/onboarding/preferences.json` | `mailProvider`, `allowLanDirectAccess` |
| `nav-recents.json` | `$BRAIN_HOME/var/nav-recents.json` | Recently visited chats, emails, docs |
| `wiki-dir-icons.json` | `$BRAIN_HOME/cache/wiki-dir-icons.json` | LLM-assigned icons per directory name |
| `localStorage` | Browser, per-device | `hearReplies`, `chatToolDisplayPreference`, onboarding stage keys |
| `sessionStorage` | Browser, per-tab | `FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY` |

Each has its own bespoke read/write module with no central registry. Adding a new preference means: choosing a store, deciding a format, writing a new module, handling defaults, and figuring out how to sync if both server and client need the value.

The `nav-recents.json` pattern is particularly wasteful: every time you open an email or doc, it reads the file, parses it, mutates the array, and rewrites the whole file — with no locking and potential race conditions across browser tabs.

---

## Target design

### Server-side: one `settings` table in the app SQLite DB

Same database as [chat-history-sqlite.md](./chat-history-sqlite.md):

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,    -- JSON-encoded value
  updated_at INTEGER NOT NULL
);

CREATE TABLE nav_recents (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,   -- 'chat' | 'email' | 'doc'
  title       TEXT NOT NULL,
  path        TEXT,
  meta        TEXT,
  accessed_at INTEGER NOT NULL
);
CREATE INDEX nav_recents_accessed ON nav_recents(accessed_at DESC);
```

`navRecentsStore.ts` becomes a thin wrapper over this table: upsert is a single `INSERT OR REPLACE`, reads are indexed queries. No full-file rewrites.

`onboardingPreferences.ts` becomes `getSettingJson(key)` / `setSettingJson(key, value)` over the same table.

### Client-side: one `clientPreferences` module

Replace the four ad-hoc `localStorage` modules with a single typed facade:

```ts
// src/client/lib/clientPreferences.ts
type ClientPreferences = {
  hearReplies: boolean
  chatToolDisplayExpanded: boolean
  // ... future additions here only
}

export function getPreference<K extends keyof ClientPreferences>(
  key: K,
  defaultValue: ClientPreferences[K],
): ClientPreferences[K]

export function setPreference<K extends keyof ClientPreferences>(
  key: K,
  value: ClientPreferences[K],
): void
```

All `localStorage` access goes through this one module. Adding a preference is a one-line type extension, not a new file.

---

## Split: what lives server vs client

- **Server** (SQLite): durable across devices and browser resets; needed by the server for request behavior (e.g. `mailProvider`, TTS `hearReplies` for SSE calls).
- **Client** (`localStorage`): ephemeral UI state that only the browser needs and doesn't need server awareness.
- The `hearReplies` preference currently straddles both — it's in `localStorage` but sent as a request param on every chat POST. This is fine short-term; if it grows, make it a server setting and drop the request param.

---

*Back: [README.md](./README.md)*
