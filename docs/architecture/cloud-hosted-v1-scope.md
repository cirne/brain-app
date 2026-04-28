# Cloud-hosted Brain v1 — Phase 0 scope

**Status:** Phase 0 complete (April 2026). Part of [OPP-041 (full epic)](../opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md) (current scale closed; [stub](../opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md)).

**Staging (April 2026):** Public **`https://staging.braintunnel.ai`** — TLS at the edge; Brain container on **port 4000 (HTTP)** behind the proxy. Durable data in the **`brain_data`** named volume with **`BRAIN_DATA_ROOT=/brain-data`** so container/image updates are **non-destructive**. Deploy and edge setup: [OPP-041 (full)](../opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md), [digitalocean.md](../digitalocean.md).

This document is the **parity matrix** and **product/engineering decisions** for running Brain on **hosted Linux** (Docker on a VM with persistent disk). It does **not** describe multi-tenant routing or identity—that starts in Phase 3–4 of the epic.

---

## What “cloud v1” means here

- **Single-tenant** deployment first: one `BRAIN_HOME` on a mounted volume, one logical user (matches Phase 1–2 of OPP-041).
- **No** macOS-only integrations: no Full Disk Access, no local `chat.db`, no Tauri shell.
- **Yes** Hono + Svelte + ripmail + vault + Google OAuth (once redirect URI gap is fixed—see below).

---

## API route parity (`/api/*`)

| Prefix | Cloud v1 | Notes |
|--------|----------|-------|
| `/api/vault` | **Supported** | Verifier + sessions under `$BRAIN_HOME/var/` per [runtime-and-routes.md](./runtime-and-routes.md). Browsers need **HTTPS** at the edge for meaningful `Secure` cookies. |
| `/api/chat` | **Supported** | SSE chat; history under `$BRAIN_HOME/chats/`. |
| `/api/skills` | **Supported** | `$BRAIN_HOME/skills/`. |
| `/api/wiki` | **Supported** | File-backed wiki on volume; see [Wiki storage decision](#wiki-storage-decision-v1-hosted). |
| `/api/files` | **Supported** | Ripmail-backed reads for UI preview. |
| `/api/inbox` | **Supported** | Ripmail. |
| `/api/calendar` | **Supported** | Ripmail calendar index (`ripmail calendar range`, etc.). |
| `/api/search` | **Supported** | Unified wiki + mail search. |
| `/api/imessage` | **Unavailable** | [`areLocalMessageToolsEnabled()`](../../src/server/lib/imessageDb.ts) is false when `chat.db` is absent (typical on Linux). Endpoints return **503** with `Local Messages database not available on this host.` |
| `/api/messages` | **Unavailable** | Alias of iMessage router; same behavior. |
| `/api/onboarding` | **Supported** | May still **mention** Apple Mail / local paths in copy—treat as **UX debt** for a cloud-only cohort (Gmail-first). |
| `/api/hub` | **Supported** | Some Hub features assume desktop (tunnel, phone/LAN access); others are fully relevant (sync, wiki health). |
| `/api/background` | **Supported** | Background runs / Your Wiki control. |
| `/api/your-wiki` | **Supported** | Continuous wiki supervisor. |
| `/api/oauth/google` | **Supported after code change** | **Gap today:** redirect URI is always loopback—see [Google OAuth (hosted)](#google-oauth-hosted). |
| `/oauth/google` | **Supported** | Browser pages: complete / error ([`oauthGoogleBrowserPages.ts`](../../src/server/routes/oauthGoogleBrowserPages.ts)). |
| `/api/dev` | **Absent** | Mounted only when `NODE_ENV !== 'production'` in [`index.ts`](../../src/server/index.ts). |

**Additional server behavior**

| Behavior | Desktop / dev | Cloud v1 |
|----------|---------------|----------|
| Bundled client IP allowlist (`allowLanDirectAccess`, loopback + Tailscale) | [`bundledNativeClientAllowlist`](../../src/server/lib/bundledNativeClientAllowlist.ts), gated on `BRAIN_BUNDLED_NATIVE` | **Not applied** when not bundled. |
| Named tunnel host + `brain_g` cookie (`brain.chatdnd.io`) | [`index.ts`](../../src/server/index.ts) middleware | **Irrelevant** for first-party HTTPS hostname; revisit if using Cloudflare Tunnel as **ingress** with same host patterns. |
| `remoteAccessEnabled` → `startTunnel` | Dev / bundled optional | **Usually off** in cloud; public ingress replaces tunnel. |
| Periodic sync, ripmail backfill, Your Wiki startup | Same | **Supported** |
| `runSplitLayoutMigrationIfNeeded` | macOS bundle wiki split | **No-op or inapplicable** on typical Linux single-tree layout; safe to run. |

---

## SPA route parity

Primary + overlay URLs are documented in [runtime-and-routes.md](./runtime-and-routes.md) (`/c`, `/c/{slug}--{uuidHex}`, `/hub`, `?panel=…`). Hosted parity is behavioral (same router bundle), not a second path scheme.

| Pattern | Cloud v1 | Notes |
|---------|----------|-------|
| `/c`, `/c/…` (chat segment; UUID chats use `slug--hex`) | **Supported** | Chat main pane; overlays via `?panel=` + payload keys. |
| `/hub?…` | **Supported** | Hub main + optional `panel=` overlay; Gmail **link-account** banners use `addedAccount` / `addAccountError` on `/hub` (see [google-oauth.md](../google-oauth.md)). |
| `/welcome`, `/demo`, dev flows | **Supported** | Same as desktop SPA. |
| Legacy path-shaped overlays (`/wiki/…`, `/inbox`, …) | **Removed** | Clean break; use `?panel=` on `/c` or `/hub`. |
| `/messages` (iMessage UI via `panel=messages`) | **Broken / misleading** | Same as before: underlying API returns 503 without `chat.db`. **Product:** hide nav entry or show “not available on this deployment” before multi-device polish. |

---

## Wiki storage decision (v1 hosted)

**Decision:** Use a **plain directory tree** on the tenant’s **persistent volume**—`wiki/` under `BRAIN_HOME` (or the equivalent path after [OPP-024](../opportunities/OPP-024-split-brain-data-synced-wiki-local-ripmail.md)-style split if we ever mirror bundle layout on server).

**Rationale:**

- [data-and-sync.md](./data-and-sync.md) already documents that wiki sync is a **no-op** and brain-app does **not** run git commit/push.
- [PRODUCTIZATION.md §2](../PRODUCTIZATION.md) lists hosted git as high friction; **volume-only files** match the current code paths and avoid provisioning GitHub tokens per user in v1.

**Deferred:** Per-user git remotes, object storage–backed wiki, migration from desktop wiki bundles.

---

## Google OAuth (hosted)

### Redirect URIs to register

For each public origin (staging, production), add **Authorized redirect URIs** in Google Cloud Console:

`https://<public-host>/api/oauth/google/callback`

Keep existing **loopback** URIs for local dev and Braintunnel.app as documented in [google-oauth.md](../google-oauth.md).

### OAuth redirect and `PUBLIC_WEB_ORIGIN`

[`googleOAuthRedirectUri()`](../../src/server/lib/brainHttpPort.ts): default loopback is `http://127.0.0.1:<PORT>/api/oauth/google/callback` (or bundled HTTPS + port). **`PUBLIC_WEB_ORIGIN`** (e.g. `http://localhost:4000` for Docker) overrides that so the post-consent URL matches the **browser host**—required when the SPA is opened at `localhost` but the default would send Google to `127.0.0.1` (different cookies).

**Still a gap** for **public TLS** hostnames (production on the internet): set `PUBLIC_WEB_ORIGIN` to your real `https://…` origin and register that redirect URI in Google Cloud.

**Policy:** [OPP-022](../opportunities/OPP-022-google-oauth-app-verification.md) applies when leaving Google’s test-user cap.

---

## Explicit non-goals (cloud v1)

- Parity with **iMessage**, **Apple Mail** local, or **FDA**.
- **Multi-tenant** security and routing (documented only; implementation is OPP-041 Phase 3–4).
- **App Platform–only** hosting without persistent block storage (see OPP-041 Phase 5).

---

## Local Docker (Phase 1)

Repo root **`Dockerfile`** + **`docker-compose.yml`**: `env_file: .env` supplies secrets; compose forces `BRAIN_HOME=/brain`, **`PORT=4000`** inside the container, and host **`${BRAIN_DOCKER_PORT:-4000}:4000`**. **`npm run docker:up`** runs **`docker:ripmail:build`** first so a Linux **`ripmail`** ELF is staged at `.docker/linux-ripmail/ripmail` (host cargo or `rust:bookworm` + cached deps). See [OPP-041 Phase 1](../opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md).

---

## References

- [runtime-and-routes.md](./runtime-and-routes.md) — canonical route list.
- [deployment-models.md](./deployment-models.md) — desktop vs cloud.
- [integrations.md](./integrations.md) — ripmail and trust boundaries.
- [packaging-and-distribution.md](../packaging-and-distribution.md) — cloud security checklist for later phases.
