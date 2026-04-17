# Architecture

Design decisions and technical rationale for brain-app. See [OPPORTUNITIES.md](./OPPORTUNITIES.md) for roadmap and [BUGS.md](./BUGS.md) for known issues.

---

## Overview

brain-app is a personal assistant web app for a single user. It wraps an LLM agent with three UI surfaces — Chat, Wiki, and Inbox — all served from a single Hono process.

```
Browser (Svelte 5 SPA)
  ↕ SSE / JSON  over HTTP
Hono server (Node 22)
  ├── /api/chat      → pi-agent-core session → LLM (Anthropic / OpenAI / etc.)
  ├── /api/wiki      → reads/writes `$BRAIN_HOME/wiki` (markdown; see `shared/brain-layout.json`)
  ├── /api/inbox     → ripmail subprocess (SQLite email index)
  └── /api/calendar  → local JSON cache (Howie API)
```

---

## Key Design Decisions

### Single server: Vite as Hono middleware

In dev, Vite runs inside the same Node HTTP server as a middleware rather than on a separate port. `/api/*` requests go to Hono; everything else goes to Vite for HMR. In production, the client is pre-built and served as static files by Hono.

**Why:** Avoids CORS and proxy configuration. Simplifies deployment — one process, one port.

---

### Agent sessions are in-memory

`getOrCreateSession()` stores `Agent` instances in a `Map<string, Agent>`. Sessions are keyed by a UUID sent from the client; those objects are discarded on server restart.

**Transcripts on disk:** Each completed turn is appended to a JSON file under `$BRAIN_HOME/chats` (default in dev: `./data/chats` when `BRAIN_HOME` defaults to `./data`). `GET /api/chat/sessions` and `GET /api/chat/sessions/:sessionId` expose saved history; `DELETE /api/chat/:sessionId` removes both the in-memory agent and the file. The live `Agent` state is still memory-only; persistence mirrors the same SSE stream the client sees.

**Implication:** After a restart, in-flight agent context is gone, but prior turns remain on disk until deleted.

---

### Future: durable app state (SQLite)

**Direction (not implemented):** brain-app may persist tenant-owned durable data (e.g. chat history, settings) in a **single SQLite database file** per deployment or per tenant. The deployment model is one instance per tenant, so there is no requirement for a remote database server. This store is **brain-app–owned** — it is not a replacement for ripmail's separate SQLite index under `RIPMAIL_HOME`, and it does not subsume wiki content under `$BRAIN_HOME/wiki`.

**Backup and restore:** SQLite's single-file model makes **copying the database file** to object storage (e.g. S3) a straightforward backup path; restore after image updates or reboots when durability is required. That aligns with a broader **per-tenant object storage** story for other artifacts (see [PRODUCTIZATION.md](./PRODUCTIZATION.md) §2 on wiki storage).

**Today:** Chat history is stored as **JSON files** under `$BRAIN_HOME/chats`. SQLite remains a possible later consolidation for settings and other durable app state.

---

### Wiki content on disk (`$BRAIN_HOME/wiki`)

Markdown wiki pages live under **`$BRAIN_HOME/wiki`** (see [`shared/brain-layout.json`](../shared/brain-layout.json)). The agent's file tools (`read`, `edit`, `write`, `grep`, `find`) are scoped to that directory. After edits, the server debounces and runs git commit/push/sync when a git remote is configured.

**Why:** Separates app code from personal knowledge. The wiki directory can be a git worktree or a plain folder; brain-app is the interface.

**User-facing name:** We describe this store as the user’s **personal wiki** (linked markdown pages—see [product/personal-wiki.md](./product/personal-wiki.md)); “wiki” here is the product metaphor, not only the engine.

**Implication:** Never create wiki `.md` content files in this repo. The agent writes under `$BRAIN_HOME/wiki` at runtime only.

---

### Agent tools: pi-coding-agent + custom

File tools (`read`, `edit`, `write`, `grep`, `find`) come from `@mariozechner/pi-coding-agent`, which provides fuzzy-matching edit and path-scoped access. Custom tools (`search_index`, `read_doc`, `list_sources`, `source_status`, `add_files_source`, `edit_files_source`, `remove_files_source`, `reindex_files_source`, `draft_email`, `send_draft`, `find_person`, `get_calendar_events`, `web_search`, `fetch_page`, `get_youtube_transcript`, `youtube_search`, …) are defined inline in `src/server/agent/tools.ts`.

**Why pi-coding-agent for file tools:** The fuzzy edit tool is significantly better than exact-match replacement for LLM-driven edits. Reusing it avoids reimplementing path security and file I/O.

**Why inline custom tools:** The custom tools are simple subprocess wrappers or API calls with no shared logic between them. No abstraction layer needed.

---

### Email via ripmail subprocess

The agent talks to email via `ripmail` CLI subprocesses (`ripmail search`, `ripmail thread`, `ripmail draft`, `ripmail send`, etc.) rather than a direct library integration.

**Why:** ripmail manages its own SQLite index and IMAP sync independently. Treating it as a subprocess means brain-app has no coupling to ripmail's internals and gets the same interface that any other agent or CLI user would get.

**Implication:** `RIPMAIL_BIN` must point to a working ripmail binary. The ripmail source lives in this repo at [`ripmail/`](../ripmail/) (Cargo workspace member). After `npm run ripmail:dev` or `cargo build -p ripmail`, the dev server points `RIPMAIL_BIN` at the workspace `ripmail` binary when present (resolved via `cargo metadata` target dir + `debug/ripmail`; see [`scripts/run-dev.mjs`](../scripts/run-dev.mjs)). You can still set `RIPMAIL_BIN` in `.env` or rely on `ripmail` on `$PATH`. The Tauri desktop app bundles a release-built `ripmail` inside `server-bundle/`; `desktop:bundle-server` builds it automatically and the Tauri shell sets `RIPMAIL_BIN` to the bundled path. Brain sets `RIPMAIL_HOME` to `$BRAIN_HOME/ripmail` when unset (override for standalone CLI).

---

### Calendar via local JSON cache

Calendar events are fetched from external sources (Howie API) and cached locally under **`$BRAIN_HOME/cache`** as JSON files. The `get_calendar_events` agent tool reads from this cache.

**Why:** Avoids hitting external calendar APIs on every agent turn. The cache is refreshed on a schedule or on demand via `/api/calendar`.

**Implication:** Calendar data can be stale. The tool response includes `fetchedAt` timestamps so the agent can communicate freshness to the user.

---

### LLM provider is configurable via env vars

The agent uses `@mariozechner/pi-ai`'s `getModel(provider, modelId)` to resolve the LLM. Provider and model are set via `LLM_PROVIDER` and `LLM_MODEL` env vars.

**Why:** Allows switching between Anthropic, OpenAI, Google, etc. without code changes. Useful for cost/quality tradeoffs or when a provider is unavailable.

**Default:** `anthropic` / `claude-sonnet-4-20250514`.

---

### Auth: Basic Auth in production only

Auth is skipped entirely in dev (`NODE_ENV !== 'production'`). In production, Basic Auth is applied to all `/api/*` routes. Can be disabled with `AUTH_DISABLED=true` for private subnet deployments.

**Why:** Simplest auth that blocks the public internet. Single-user app — no session management or OAuth needed.

---

### SSE streaming for chat

`POST /api/chat` returns a Server-Sent Events stream. The client receives events: `session`, `text_delta`, `thinking`, `tool_start`, `tool_end`, `done`, `error`.

**Why:** Lets the UI show token-by-token text and real-time tool progress without polling. HTTP/1.1 compatible, no WebSocket setup required.

---

## Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `AUTH_USER` | `lew` | Basic auth username (prod only) |
| `AUTH_PASS` | `changeme` | Basic auth password (prod only) |
| `AUTH_DISABLED` | — | Set to `true` to skip auth in prod (private subnet) |
| `BRAIN_HOME` | `./data` (dev) / see Tauri | Root for wiki, skills, chats, cache, var, ripmail (see `shared/brain-layout.json`) |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail binary |
| `RIPMAIL_HOME` | `$BRAIN_HOME/ripmail` | Ripmail config + SQLite; unset → derived from `BRAIN_HOME` in Brain; standalone CLI may use `~/.ripmail` |
| `RIPMAIL_EMAIL_ADDRESS` | — | Optional; non-interactive ripmail setup |
| `RIPMAIL_IMAP_PASSWORD` | — | Gmail app password for setup |
| `OPENAI_API_KEY` | — | Ripmail setup validation / optional ripmail LLM features |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `LLM_PROVIDER` | `anthropic` | LLM provider (`anthropic`, `openai`, `google`, etc.) |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model ID for the selected provider |
| `EXA_API_KEY` | — | Required for `web_search` tool |
| `SUPADATA_API_KEY` | — | Required for `fetch_page` and YouTube tools |
| `PORT` | `3000` | HTTP port for `npm run dev` (`start:local` uses `4000` unless overridden) |
| `BRAIN_BUNDLED_NATIVE` | — | Set to `1` only by the Tauri app when spawning Node; the server binds `18473`–`18522` (skips IANA-reserved TCP `18516`) using constants, not `PORT` |

---

## Deployment

**Primary release:** macOS **Brain.app** (Tauri) — see [OPP-007](opportunities/OPP-007-native-mac-app.md). The launcher sets `BRAIN_HOME` and derived paths (see [`desktop/src/brain_paths.rs`](../desktop/src/brain_paths.rs) and [`shared/brain-layout.json`](../shared/brain-layout.json)).

**Development:** `npm run dev` — optional `BRAIN_HOME`; defaults to `./data` under the repo.

**Docker:** Not supported in-repo. Historical Dockerfile/compose/workflow and restoration notes: [OPP-013](opportunities/OPP-013-docker-deployment-restoration.md).
