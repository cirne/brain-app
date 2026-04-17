# Server runtime and HTTP routing

## Single process

The browser loads a **Svelte 5** SPA. In **development**, **Vite** runs in **middleware mode** on the same Node HTTP server as **Hono**: requests whose path starts with `/api/` are handled by Hono; everything else goes to Vite (HMR included). In **production**, the client is pre-built under `dist/client` and served by Hono with SPA fallback.

**Why one port:** No CORS or dev proxy between UI and API.

Entry: [`src/server/index.ts`](../../src/server/index.ts).

## Mounted API routes

| Prefix | Role |
|--------|------|
| `/api/chat` | Agent chat — SSE (`POST /`), session list/load/delete |
| `/api/wiki` | Wiki CRUD, sync trigger, previews |
| `/api/files` | Raw filesystem read via ripmail (`GET /read`) for UI preview |
| `/api/inbox` | Inbox UI data (ripmail-backed) |
| `/api/calendar` | Calendar cache read API |
| `/api/search` | Unified wiki + email search (grep + ripmail) |
| `/api/imessage` | macOS iMessage/SMS tools when `chat.db` is readable |
| `/api/messages` | Alias mount for the same iMessage router |
| `/api/skills` | Slash skills / skill assets under `$BRAIN_HOME/skills` |
| `/api/onboarding` | Onboarding flow, ripmail setup hints |
| `/api/dev` | **Dev only** — diagnostics |

## Production vs bundled native

- **Normal production** (`NODE_ENV=production`, not Tauri): listen on `PORT` (default `3000`), static files from `dist/client`.
- **Bundled Brain.app** (`BRAIN_BUNDLED_NATIVE=1`): the server binds the **first free port** in a fixed range (see [`nativeAppPort.ts`](../../src/server/lib/nativeAppPort.ts)); `PORT` is not used for that mode.

## Auth

In production, unless `AUTH_DISABLED=true`, Hono **`basicAuth`** protects `/api/*`. Dev skips auth (`NODE_ENV !== 'production'`).

## Periodic background work

On server start and on a timer (default **300 s**, override `SYNC_INTERVAL_SECONDS`), the server runs [`runFullSync()`](../../src/server/lib/syncAll.ts): wiki no-op, detached `ripmail refresh`, and calendar ICS fetch when URLs are set. The same full sync runs on graceful shutdown (SIGINT/SIGTERM).

---

*Next: [agent-chat.md](./agent-chat.md) · [data-and-sync.md](./data-and-sync.md)*
