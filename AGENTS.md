# brain-app

Hono + Svelte + pi-agent-core web app. Personal assistant with three surfaces: Chat (agentic), Wiki browser, Inbox (ripmail).

See `/Users/cirne/brain/wiki/ideas/brain-in-the-cloud.md` for full product spec.

## Developer docs

- [docs/VISION.md](docs/VISION.md) — product vision and long-term direction
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design decisions, key patterns, env vars
- [docs/BUGS.md](docs/BUGS.md) — known bugs (active + archived)
- [docs/OPPORTUNITIES.md](docs/OPPORTUNITIES.md) — feature ideas and improvements
- [docs/PRODUCTIZATION.md](docs/PRODUCTIZATION.md) — blockers and tradeoffs for generalizing to multi-user product

## Stack

| Layer | Package |
|---|---|
| Server | Hono + @hono/node-server |
| Agent | @mariozechner/pi-agent-core + pi-coding-agent |
| LLM | @mariozechner/pi-ai (multi-provider: Anthropic, OpenAI, etc.) |
| Chat UI | Svelte 5 (custom streaming SSE client) |
| Wiki / Inbox UI | Svelte 5 |
| Email | ripmail binary (subprocess) |
| DB | better-sqlite3 (app state; ripmail manages its own SQLite) |
| Deploy | Fly.io via Dockerfile |

## Dev

```sh
nvm use          # switches to Node 22
npm install
npm run dev      # starts Hono + Vite HMR on single port 3000
```

Single server: Vite runs as middleware inside Hono. API requests go to Hono routes; everything else goes to Vite for HMR.

Auth is skipped in dev mode (`NODE_ENV !== 'production'`).

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `AUTH_USER` | `lew` | Basic auth username (prod only) |
| `AUTH_PASS` | `changeme` | Basic auth password (prod only) |
| `WIKI_DIR` | `/wiki` | Path to wiki (brain repo root or wiki subdir) |
| `WIKI_GIT_TOKEN` | — | Authenticated HTTPS git clone URL for the wiki (e.g. `https://x-access-token:PAT@github.com/org/repo.git`). If unset, clones public `cirne/brain` read-only |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail binary |
| `RIPMAIL_HOME` | `~/.ripmail` | Ripmail config + SQLite (Dockerfile sets `/ripmail`) |
| `RIPMAIL_EMAIL_ADDRESS` | — | Gmail address for non-interactive `ripmail setup` in `start.sh` when no config |
| `RIPMAIL_IMAP_PASSWORD` | — | Gmail app password for that setup |
| `OPENAI_API_KEY` | — | Used by ripmail setup validation and optional ripmail LLM features |
| `ANTHROPIC_API_KEY` | — | Required for agent |
| `LLM_PROVIDER` | `anthropic` | LLM provider (anthropic, openai, google, etc.) |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model ID |
| `PORT` | `3000` | HTTP port |
| `SYNC_INTERVAL_SECONDS` | `300` | Seconds between in-process full syncs (wiki git + ripmail + calendar); invalid/unset uses default |

Create a `.env` file locally (it is gitignored).

## Structure

```
src/
  server/
    index.ts           # Hono entry point, auth, Vite middleware
    sync-cli.ts        # `npm run sync` — full sync (wiki + inbox + calendar); used by start.sh
    routes/
      chat.ts          # POST /api/chat — SSE agent stream
      chat.test.ts     # Chat route tests
      wiki.ts          # GET /api/wiki, /api/wiki/search, /api/wiki/:path
      wiki.test.ts     # Wiki route tests
      inbox.ts         # GET/POST /api/inbox (ripmail subprocess)
    agent/
      index.ts         # pi-agent-core session management + Agent factory
      tools.ts         # pi-coding-agent file tools + custom ripmail/git tools
      tools.test.ts    # Agent tools tests
  client/
    index.html         # Mobile-first meta tags
    main.ts            # Svelte mount
    style.css          # Dark theme design tokens
    App.svelte         # Tab shell: Chat | Wiki | Inbox + file-grounded navigation
    lib/
      Chat.svelte      # Streaming SSE chat with @mention autocomplete + tool viz
      Wiki.svelte      # File tree + markdown viewer + search + "Chat about this"
      Inbox.svelte     # Email list + thread view + archive/read actions
```

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/chat` | SSE stream — body: `{message, sessionId?, context?}` |
| DELETE | `/api/chat/:sessionId` | Delete chat session |
| GET | `/api/wiki` | List all markdown files |
| GET | `/api/wiki/search?q=...` | Search wiki content |
| GET | `/api/wiki/git-status` | Git SHA + date |
| GET | `/api/wiki/:path` | Read + render wiki page |
| GET | `/api/inbox` | List inbox emails |
| POST | `/api/inbox/sync` | Trigger IMAP sync |
| GET | `/api/inbox/:id` | Read email thread |
| POST | `/api/inbox/:id/archive` | Archive email |
| POST | `/api/inbox/:id/read` | Mark email read |

## Agent tools

The agent has these tools (via pi-coding-agent + custom):
- `read` — read file content (pi-coding-agent, scoped to WIKI_DIR)
- `edit` — oldText/newText edit with fuzzy matching (pi-coding-agent)
- `write` — create/overwrite files (pi-coding-agent)
- `grep` — search file content (pi-coding-agent)
- `find` — find files by name pattern (pi-coding-agent)
- `search_email` — ripmail full-text search
- `read_email` — read email thread by ID
- `list_inbox` — inbox list via ripmail `inbox` (same as UI; use for bulk actions when search is wrong)
- `archive_emails` — archive messages by ID (ripmail `archive`, batch)
- `git_commit_push` — stage, commit, push wiki changes
- `web_search` — Exa web search for current info (requires `EXA_API_KEY`)
- `fetch_page`, `youtube_search`, `get_youtube_transcript` — URL article text and YouTube search/transcripts (requires `SUPADATA_API_KEY`)

## Wiki

Wiki content lives in the external brain repo at the path specified by `WIKI_DIR` in `.env` (locally `~/brain`, wiki at `~/brain/wiki`). **Never create or commit wiki/content `.md` files in this repository.** The agent reads and writes wiki files via its scoped file tools, which resolve to `WIKI_DIR` at runtime. Wiki schema and conventions are documented in `~/brain/CLAUDE.md`.

## Development rules

- **Tests required**: every new feature or bug fix needs test coverage in `src/**/*.test.ts`.
- **TDD for bugs**: reproduce with a failing test first, then fix, then confirm green.
- **Lint before commit**: run `npm run lint` — the `ci` script runs lint + typecheck + tests.
- **DRY**: extract shared logic; never duplicate. Shared fixtures live in `src/server/test-fixtures.ts`.
- **Test fixtures**: reuse the shared `wikiDir` fixture pattern (see existing tests). Don't create one-off temp dirs per test.
- **No React, no Next.js**: Svelte 5 for all UI.

## Deployment

```sh
npm run build        # builds client to dist/client, server to dist/server
fly deploy           # builds Docker image and deploys
```

Pushes to `main` also build and push a container image to **GitHub Container Registry** (`ghcr.io/<owner>/<repo>`). For a private repo, pull hosts need a GitHub PAT with `read:packages` and `docker login ghcr.io` before `docker pull`. See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deployment)** for the full flow (login, one-liner run with `--env-file .env`, optional volumes).

Wiki content is not baked into the image — `start.sh` clones/pulls at runtime.
In Docker, ripmail state lives under `/ripmail` inside the container (see `start.sh` and Dockerfile `RIPMAIL_HOME`); no bind mount or Fly volume by default.
