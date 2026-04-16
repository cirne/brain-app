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

`getOrCreateSession()` stores `Agent` instances in a `Map<string, Agent>`. Sessions are keyed by a UUID sent from the client; those objects are discarded on server restart.

**Transcripts on disk:** Each completed turn is appended to a JSON file under `CHAT_DATA_DIR` (default `./data/chats`). `GET /api/chat/sessions` and `GET /api/chat/sessions/:sessionId` expose saved history; `DELETE /api/chat/:sessionId` removes both the in-memory agent and the file. The live `Agent` state is still memory-only; persistence mirrors the same SSE stream the client sees.

**Implication:** After a restart, in-flight agent context is gone, but prior turns remain on disk until deleted. Without a volume mount, chat files are lost when the container image is replaced (same as other `data/` caches).

---

### Future: durable app state (SQLite)

**Direction (not implemented):** brain-app may persist tenant-owned durable data (e.g. chat history, settings) in a **single SQLite database file** per deployment or per tenant. The deployment model is one instance per tenant, so there is no requirement for a remote database server. This store is **brain-app–owned** — it is not a replacement for ripmail's separate SQLite index under `RIPMAIL_HOME`, and it does not subsume wiki content in `WIKI_DIR`.

**Backup and restore:** SQLite's single-file model makes **copying the database file** to object storage (e.g. S3) a straightforward backup path; restore after image updates or reboots when durability is required. That aligns with a broader **per-tenant object storage** story for other artifacts (see [PRODUCTIZATION.md](./PRODUCTIZATION.md) §2 on wiki storage).

**Today:** Chat history is stored as **JSON files** under `CHAT_DATA_DIR` (see above). SQLite remains a possible later consolidation for settings and other durable app state.

---

### Wiki lives in an external git repo (not this repo)

Wiki content is read from/written to `WIKI_DIR` — a separate brain repo cloned at runtime. The agent's file tools (`read`, `edit`, `write`, `grep`, `find`) are scoped to this directory. After edits, the server debounces and runs git commit/push/sync so the agent does not need a separate commit tool.

**Why:** Separates app code from personal knowledge. The brain repo is the source of truth; brain-app is the interface to it. This lets the wiki be edited directly via git, other tools, or other apps independently of this app.

**Implication:** Never create wiki `.md` content files in this repo. The agent writes to `WIKI_DIR` at runtime only.

---

### Agent tools: pi-coding-agent + custom

File tools (`read`, `edit`, `write`, `grep`, `find`) come from `@mariozechner/pi-coding-agent`, which provides fuzzy-matching edit and path-scoped access. Custom tools (`search_email`, `read_email`, `draft_email`, `send_draft`, `find_person`, `get_calendar_events`, `web_search`, `fetch_page`, `get_youtube_transcript`, `youtube_search`) are defined inline in `src/server/agent/tools.ts`.

**Why pi-coding-agent for file tools:** The fuzzy edit tool is significantly better than exact-match replacement for LLM-driven edits. Reusing it avoids reimplementing path security and file I/O.

**Why inline custom tools:** The custom tools are simple subprocess wrappers or API calls with no shared logic between them. No abstraction layer needed.

---

### Email via ripmail subprocess

The agent talks to email via `ripmail` CLI subprocesses (`ripmail search`, `ripmail thread`, `ripmail draft`, `ripmail send`, etc.) rather than a direct library integration.

**Why:** ripmail manages its own SQLite index and IMAP sync independently. Treating it as a subprocess means brain-app has no coupling to ripmail's internals and gets the same interface that any other agent or CLI user would get.

**Implication:** `RIPMAIL_BIN` must point to a working ripmail binary. The ripmail source lives in this repo at [`ripmail/`](../ripmail/) (Cargo workspace member). After `npm run ripmail:dev` or `cargo build -p ripmail`, the dev server points `RIPMAIL_BIN` at the workspace `ripmail` binary when present (resolved via `cargo metadata` target dir + `debug/ripmail`; see [`scripts/run-dev.mjs`](../scripts/run-dev.mjs)). You can still set `RIPMAIL_BIN` in `.env` or rely on `ripmail` on `$PATH`. In Docker, the image installs a binary at build time (see Dockerfile). The Tauri desktop app bundles a release-built ripmail sidecar via [`scripts/link-ripmail-sidecar.mjs`](../scripts/link-ripmail-sidecar.mjs).

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
| `WIKI_GIT_TOKEN` | — | Authenticated HTTPS clone URL for the wiki (see `start.sh`). If unset, public clone |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail binary |
| `RIPMAIL_HOME` | `~/.ripmail` | Ripmail config + SQLite (Dockerfile sets `/ripmail`) |
| `RIPMAIL_EMAIL_ADDRESS` | — | Gmail for non-interactive `ripmail setup` in `start.sh` |
| `RIPMAIL_IMAP_PASSWORD` | — | Gmail app password for setup |
| `OPENAI_API_KEY` | — | Ripmail setup validation / optional ripmail LLM features |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `LLM_PROVIDER` | `anthropic` | LLM provider (`anthropic`, `openai`, `google`, etc.) |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model ID for the selected provider |
| `EXA_API_KEY` | — | Required for `web_search` tool |
| `SUPADATA_API_KEY` | — | Required for `fetch_page` and YouTube tools |
| `CHAT_DATA_DIR` | `./data/chats` | Persisted chat transcripts (JSON files; gitignored `data/` parent) |
| `PORT` | `3000` | HTTP port for `npm run dev` and Docker/container runs (`start:local` uses `4000` unless overridden) |
| `BRAIN_BUNDLED_NATIVE` | — | Set to `1` only by the Tauri app when spawning Node; the server binds `18473`–`18522` (skips IANA-reserved TCP `18516`) using constants, not `PORT` |

---

## Deployment

The app runs as a Docker container. `start.sh` clones/pulls the brain wiki repo at container startup into `/wiki` (no wiki volume; use `WIKI_GIT_TOKEN` for authenticated clone/push). Ripmail config and SQLite live under `/ripmail` (`RIPMAIL_HOME`) inside the image unless you override paths; no default bind mount.

Deployment platform is not yet decided — Fly.io (`fly.toml` exists as a starting point) and DigitalOcean App Platform are both viable options.

### Container image: GitHub Container Registry (GHCR)

On every push to `main`, GitHub Actions (`.github/workflows/docker-publish.yml`) builds the `Dockerfile` and pushes to **GitHub Container Registry**:

- **Image:** `ghcr.io/<owner>/<repo>:latest` and `:main` (same as the GitHub repo path, lowercased by GitHub).

The workflow uses `GITHUB_TOKEN` with `packages: write` — no extra secrets are required for CI to publish.

For a **private** repository, the package is typically **private** as well. Anyone pulling the image on another machine must authenticate to GHCR with a credential that can read packages.

### Pulling a private image on a remote host

1. Create a **Personal Access Token** (classic or fine-grained) with at least **`read:packages`** (classic) or the equivalent package read permission (fine-grained). Do not commit the token.

2. On the host, log in to GHCR using the token (replace `YOUR_GITHUB_USERNAME`):

   ```sh
   export GHCR_TOKEN=ghp_xxxxxxxx   # or: read from your secret store / paste once
   echo "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
   ```

   Avoid putting the token on the command line as a literal — use `echo "$GHCR_TOKEN"` as above, or a credential helper. Unset `GHCR_TOKEN` after login if you prefer not to leave it in the shell.

3. Pull and run with your existing `.env` (defaults to `PORT=3000`; map the same port on the host):

   ```sh
   docker pull ghcr.io/<owner>/<repo>:latest && \
     docker run --rm -p 3000:3000 --env-file .env ghcr.io/<owner>/<repo>:latest
   ```

   If `.env` sets `PORT` to something other than `3000`, use `-p <port>:<port>` to match.

4. **Optional persistence:** add volume mounts so wiki, ripmail, and chat transcripts survive container removal, e.g. `-v brain-wiki:/wiki -v brain-ripmail:/ripmail -v brain-chats:/path/to/data/chats` (set `CHAT_DATA_DIR` to match the mount) before the image name. If the app adds a SQLite store for durable tenant data, mount that path the same way once a concrete path is chosen.

### Local container testing (build from source)

```sh
docker compose up --build
```

Set `WIKI_GIT_TOKEN` (optional) and ripmail-related vars in `.env` (see `.env.example`). The wiki is cloned inside the container; ripmail uses `/ripmail` in the container without a host volume by default.
