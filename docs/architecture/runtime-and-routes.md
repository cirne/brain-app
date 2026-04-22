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
| `/api/background` | Background agent run history and control (wiki expansion) |
| `/api/events` | **SSE** (`GET /`) — live `your_wiki` + `background_agents` snapshots and push for Hub (see [`hubEvents.ts`](../../src/server/routes/hubEvents.ts)) |
| `/api/dev` | **Dev only** — diagnostics |

## Client-side URL paths (SPA routes)

| Path | Role |
|------|------|
| `/` | Main chat interface |
| `/hub` | **Brain Hub** — Admin, settings, wiki health, and background activity |
| `/wiki/...` | Wiki document viewer/editor |
| `/files/...` | Raw file preview |
| `/inbox` | Email inbox |
| `/calendar` | Calendar view |
| `/messages` | SMS/iMessage thread view |
| `/onboarding` | Onboarding wizard |

## Production vs bundled native

- **Normal production** (`NODE_ENV=production`, not Tauri): listen on `PORT` (default `3000`), static files from `dist/client`.
- **Bundled Brain.app** (`BRAIN_BUNDLED_NATIVE=1`): the server listens on **`0.0.0.0:18473`** (first free in `18473`–`18476`) with **HTTPS** and a self-signed cert in `$BRAIN_HOME/var` (see [`embeddedServerTls.ts`](../../src/server/lib/embeddedServerTls.ts), OPP-023). `PORT` is not used for that mode. The Tauri webview loads **`https://127.0.0.1:<port>/`**. The desktop shell probes the canonical port range until the listener appears (see [`native_port.rs`](../../desktop/src/native_port.rs)).

### Tailscale / remote access (bundled only)

Binding **`0.0.0.0`** lets other devices reach Brain on this machine’s **Tailscale IP** (e.g. `https://100.x.x.x:18473`) without `tailscale serve`. Only your tailnet can route to that address; other tailnets cannot.

To avoid cleartext session cookies, the embedded app uses **HTTPS**; **Secure** `brain_session` is set for bundled traffic.

By default, to avoid arbitrary **private LAN** clients (e.g. `192.168.x.x` on the same Wi‑Fi), the bundled server **drops** TCP connections whose remote address is not **loopback** (`127.0.0.0/8`, `::1`) or **RFC 6598** CGNAT **`100.64.0.0/10`** (Tailscale). Users can opt in to **same-LAN direct** from Hub (Phone access) via `allowLanDirectAccess` in onboarding preferences: then only vault-gated access applies at the HTTP layer (TLS still required for meaningful `Secure` cookies in browsers). Gmail OAuth uses a registered **`https://127.0.0.1:<port>/...`** callback; that flow stays on loopback.

Implementation: [`bundledNativeClientAllowlist.ts`](../../src/server/lib/bundledNativeClientAllowlist.ts), [`onboardingPreferences.ts`](../../src/server/lib/onboardingPreferences.ts).

## Auth

The server stores a vault password verifier under `$BRAIN_HOME/var/` (`vault-verifier.json`). After unlock, an **HttpOnly session cookie** (`brain_session`) gates **`/api/*`** except bootstrap routes (`/api/vault/*`, `GET /api/onboarding/status` before a vault exists, Gmail OAuth callbacks, and dev-only `POST /api/dev/hard-reset` … in non-production).

## Periodic background work

On server start and on a timer (default **300 s**, override `SYNC_INTERVAL_SECONDS`), the server runs [`runFullSync()`](../../src/server/lib/syncAll.ts): wiki no-op, detached `ripmail refresh`, and calendar ICS fetch when URLs are set. The same full sync runs on graceful shutdown (SIGINT/SIGTERM). **Manual sync** is triggered from the **Brain Hub** (`/hub`).

---

*Next: [agent-chat.md](./agent-chat.md) · [data-and-sync.md](./data-and-sync.md)*
