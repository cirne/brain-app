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
- **Bundled Brain.app** (`BRAIN_BUNDLED_NATIVE=1`): the server listens on **`0.0.0.0:18473`** (see [`src/server/index.ts`](../../src/server/index.ts)); `PORT` is not used for that mode. The desktop shell probes the canonical port range until the listener appears (see [`native_port.rs`](../../desktop/src/native_port.rs)).

### Tailscale / remote access (bundled only)

Binding **`0.0.0.0`** lets other devices reach Brain on this machine’s **Tailscale IP** (e.g. `http://100.x.x.x:18473`) without `tailscale serve`. Only your tailnet can route to that address; other tailnets cannot.

To avoid exposing the same port to arbitrary **LAN** clients (e.g. `192.168.x.x`), the bundled server **drops** TCP connections whose remote address is not **loopback** (`127.0.0.0/8`, `::1`) or **RFC 6598** CGNAT **`100.64.0.0/10`** (Tailscale node addresses). Gmail OAuth still uses the registered **`http://127.0.0.1:18473/...`** redirect URI; that traffic stays loopback.

Implementation: [`bundledNativeClientAllowlist.ts`](../../src/server/lib/bundledNativeClientAllowlist.ts).

## Auth

In production, unless `AUTH_DISABLED=true`, Hono **`basicAuth`** protects `/api/*`. Dev skips auth (`NODE_ENV !== 'production'`).

## Periodic background work

On server start and on a timer (default **300 s**, override `SYNC_INTERVAL_SECONDS`), the server runs [`runFullSync()`](../../src/server/lib/syncAll.ts): wiki no-op, detached `ripmail refresh`, and calendar ICS fetch when URLs are set. The same full sync runs on graceful shutdown (SIGINT/SIGTERM).

---

*Next: [agent-chat.md](./agent-chat.md) · [data-and-sync.md](./data-and-sync.md)*
