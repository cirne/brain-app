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
  ├── /api/wiki      → reads/writes WIKI_DIR (external brain git repo)
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

`getOrCreateSession()` stores `Agent` instances in a `Map<string, Agent>`. Sessions are keyed by a UUID sent from the client and are lost on server restart.

**Why:** No persistence requirement for a personal app. Simplicity wins over durability here. The wiki and email are the persistent knowledge stores; chat history is ephemeral by design.

**Implication:** If you restart the server mid-conversation, the client gets a new session automatically (the next message creates one). The user loses conversational context but nothing is broken.

---

### Wiki lives in an external git repo (not this repo)

Wiki content is read from/written to `WIKI_DIR` — a separate brain repo cloned at runtime. The agent's file tools (`read`, `edit`, `write`, `grep`, `find`) are scoped to this directory. The `git_commit_push` tool stages and pushes changes back to that repo.

**Why:** Separates app code from personal knowledge. The brain repo is the source of truth; brain-app is the interface to it. This lets the wiki be edited directly via git, other tools, or other apps independently of this app.

**Implication:** Never create wiki `.md` content files in this repo. The agent writes to `WIKI_DIR` at runtime only.

---

### Agent tools: pi-coding-agent + custom

File tools (`read`, `edit`, `write`, `grep`, `find`) come from `@mariozechner/pi-coding-agent`, which provides fuzzy-matching edit and path-scoped access. Custom tools (`search_email`, `read_email`, `draft_email`, `send_draft`, `git_commit_push`, `find_person`, `wiki_log`, `get_calendar_events`, `web_search`, `fetch_page`, `get_youtube_transcript`, `youtube_search`) are defined inline in `src/server/agent/tools.ts`.

**Why pi-coding-agent for file tools:** The fuzzy edit tool is significantly better than exact-match replacement for LLM-driven edits. Reusing it avoids reimplementing path security and file I/O.

**Why inline custom tools:** The custom tools are simple subprocess wrappers or API calls with no shared logic between them. No abstraction layer needed.

---

### Email via ripmail subprocess

The agent talks to email via `ripmail` CLI subprocesses (`ripmail search`, `ripmail thread`, `ripmail draft`, `ripmail send`, etc.) rather than a direct library integration.

**Why:** ripmail manages its own SQLite index and IMAP sync independently. Treating it as a subprocess means brain-app has no coupling to ripmail's internals and gets the same interface that any other agent or CLI user would get.

**Implication:** `RIPMAIL_BIN` must point to a working ripmail binary. On Fly.io the binary is baked into the Docker image; locally it's assumed to be on `$PATH`.

---

### Calendar via local JSON cache

Calendar events are fetched from external sources (Howie API) and cached locally in `data/` as JSON files. The `get_calendar_events` agent tool reads from this cache.

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
| `WIKI_DIR` | `/wiki` | Path to wiki directory (brain repo root or wiki subdir) |
| `WIKI_REPO` | `https://github.com/cirne/brain` | Repo to clone on startup if `WIKI_DIR` doesn't exist |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail binary |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `LLM_PROVIDER` | `anthropic` | LLM provider (`anthropic`, `openai`, `google`, etc.) |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model ID for the selected provider |
| `EXA_API_KEY` | — | Required for `web_search` tool |
| `SUPADATA_API_KEY` | — | Required for `fetch_page` and YouTube tools |
| `PORT` | `3000` | HTTP port |

---

## Deployment

Deployed on Fly.io via Docker. `start.sh` clones/pulls the brain wiki repo at container startup. The ripmail SQLite index lives on the `brain_data` persistent volume at `/data`. The wiki is cloned fresh each deploy (ephemeral container storage).

```
fly deploy    # builds Docker image, deploys to Fly.io
```
