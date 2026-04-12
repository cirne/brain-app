# brain-app

Hono + Svelte + pi-agent-core web app. Personal assistant with three surfaces: Chat (agentic), Wiki browser, Inbox (ripmail).

See `/Users/cirne/brain/wiki/ideas/brain-in-the-cloud.md` for full product spec.

## Stack

| Layer | Package |
|---|---|
| Server | Hono + @hono/node-server |
| Agent | @mariozechner/pi-agent-core + pi-coding-agent |
| LLM | @mariozechner/pi-ai (Anthropic backend) |
| Chat UI | @mariozechner/pi-web-ui (Lit web components) |
| Wiki / Inbox UI | Svelte 5 |
| Email | ripmail binary (subprocess) |
| DB | better-sqlite3 (app state; ripmail manages its own SQLite) |
| Deploy | Fly.io via Dockerfile |

## Dev

```sh
nvm use          # switches to Node 22
npm install
npm run dev      # starts server (port 3000) + Vite (port 5173) concurrently
```

Vite proxies `/api/*` to the Hono server in dev mode.

## Env vars

| Var | Default | Purpose |
|---|---|---|
| `AUTH_USER` | `lew` | Basic auth username |
| `AUTH_PASS` | `changeme` | Basic auth password — override in prod |
| `WIKI_DIR` | `/wiki` | Path to wiki git clone |
| `WIKI_REPO` | `https://github.com/cirne/brain` | Repo to clone on startup |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail binary |
| `ANTHROPIC_API_KEY` | — | Required for agent |
| `PORT` | `3000` | HTTP port |

Create a `.env` file locally (it is gitignored).

## Structure

```
src/
  server/
    index.ts           # Hono entry point, auth, static serving
    routes/
      chat.ts          # POST /api/chat — SSE agent stream
      wiki.ts          # GET /api/wiki, /api/wiki/:path
      inbox.ts         # GET/POST /api/inbox (ripmail subprocess)
    agent/
      index.ts         # pi-agent-core loop (stub — wire up pi packages)
      tools.ts         # wiki + ripmail + git tool definitions
  client/
    index.html
    main.ts            # Svelte mount
    App.svelte         # Tab shell: Chat | Wiki | Inbox
    lib/
      Chat.svelte      # TODO: integrate pi-web-ui components
      Wiki.svelte      # File tree + markdown viewer
      Inbox.svelte     # Email list + archive/read actions
```

## Development rules

- **Tests required**: every new feature or bug fix needs test coverage in `src/**/*.test.ts`.
- **TDD for bugs**: reproduce with a failing test first, then fix, then confirm green.
- **Lint before commit**: run `npm run lint` — the `ci` script runs lint + typecheck + tests.
- **DRY**: extract shared logic; never duplicate. Shared fixtures live in `src/server/test-fixtures.ts`.
- **Test fixtures**: reuse the shared `wikiDir` fixture pattern (see existing tests). Don't create one-off temp dirs per test.
- **No React, no Next.js**: Svelte for UI, Lit (pi-web-ui) for chat components.

## Deployment

```sh
npm run build        # builds client to dist/client, server to dist/server
fly deploy           # builds Docker image and deploys
```

Wiki content is not baked into the image — `start.sh` clones/pulls at runtime.
Ripmail SQLite index lives on the `brain_data` Fly.io volume at `/data`.
