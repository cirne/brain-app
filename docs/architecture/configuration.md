# Configuration and environment variables

Authoritative inline comments for a minimal dev setup: [`.env.example`](../../.env.example). The table below lists variables commonly used across the server, agent, and ripmail.

| Variable | Typical / default | Purpose |
|----------|-------------------|---------|
| `BRAIN_HOME` | `./data` (dev); `~/Library/Application Support/Brain` (bundled macOS) | Local root: chats, skills, ripmail, cache, `var/` — not the wiki vault on bundled macOS (see `BRAIN_WIKI_ROOT`). **Mutually exclusive with `BRAIN_DATA_ROOT`** (do not set both). |
| `BRAIN_DATA_ROOT` | — | **Multi-tenant cloud:** mounted volume root; each workspace is a subdirectory named by a **workspace handle** (URL-safe slug) under `$BRAIN_DATA_ROOT/<handle>/` (full home tree: `wiki/`, `ripmail/`, `var/`, …). Handles are **not user-chosen** in hosted mode: Google OAuth sign-in derives a slug from mailbox email (with collision suffixes). Stable identity ↔ handle mapping (`google:<sub>`) lives in **`$BRAIN_DATA_ROOT/.global/tenant-registry.json`** together with **`brain_session`** routing. Auth is **Google OAuth only** — no vault password endpoints in MT; see [google-oauth.md](../google-oauth.md). Do not set `BRAIN_HOME` when this is set. See [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md). **DigitalOcean staging** ([`docker-compose.do.yml`](../../docker-compose.do.yml)): Docker named volume → **`/brain-data`** so **image updates / container restarts** do not delete data. **Breaking:** older previews used UUID directory names—reset or recreate the Docker volume rather than migrating. |
| `BRAIN_WIKI_ROOT` | `~/Documents/Brain` (bundled macOS when unset) | Parent directory of the `wiki/` folder (`$BRAIN_WIKI_ROOT/wiki`). Dev / non-macOS: same as `BRAIN_HOME` when unset. Set by Tauri on macOS; ignored from `.env` when bundled. **Ignored in multi-tenant mode** (wiki lives under each tenant home). |
| `BRAIN_BUNDLED_NATIVE` | — | Set to `1` by Tauri when spawning the bundled server |
| `BRAIN_EMBED_MASTER_KEY` | — | Tauri release: encrypt allowlisted secrets embedded in the native binary (LLM/tool keys + optional `GOOGLE_OAUTH_*` for packaged Gmail OAuth) |
| `NODE_ENV` | `development` / `production` | Controls build-time behavior for Vite/esbuild (vault session applies in dev and prod) |
| `PORT` | `3000` | Listen port for dev / non-bundled `node dist/server`; bundled app uses `18473` on **`0.0.0.0`** ([Tailscale / LAN policy](./runtime-and-routes.md#tailscale--remote-access-bundled-only)) |
| `PUBLIC_WEB_ORIGIN` | — | Optional `http(s)://host:port` (no trailing slash). When set and not bundled, [Gmail OAuth redirect](../google-oauth.md) uses this origin so sign-in returns to the same host as the SPA (avoids `localhost` vs `127.0.0.1` cookies). Docker Compose defaults `http://localhost:4000`. **Production:** set to your public `https://…` URL for hosted deploys; if unset, OAuth may infer from `X-Forwarded-Proto` / `Host` (reverse proxies). |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail executable |
| `RIPMAIL_HOME` | `$BRAIN_HOME/ripmail` | Ripmail data dir when unset in Braintunnel (**ignored when `BRAIN_DATA_ROOT` is set** — always `$tenantHome/ripmail`). |
| `RIPMAIL_EMAIL_ADDRESS` / `RIPMAIL_IMAP_PASSWORD` | — | Non-interactive ripmail setup |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | — | In-app Gmail OAuth ([docs/google-oauth.md](../google-oauth.md)); redirect URI follows `PORT` / `PUBLIC_WEB_ORIGIN` / bundled ports. For **Braintunnel.app**, set in `.env` when building with `BRAIN_EMBED_MASTER_KEY` so they are embedded like other allowlisted secrets (GUI apps do not load shell `.env`). |
| `RIPMAIL_GOOGLE_OAUTH_CLIENT_ID` / `RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET` | — | Ripmail token refresh; if unset, Braintunnel maps from `GOOGLE_OAUTH_*` in `ripmailProcessEnv` |
| `OPENAI_API_KEY` | — | Ripmail validation / optional ripmail LLM features |
| `LLM_PROVIDER` | `openai` | Agent LLM: any `@mariozechner/pi-ai` **`KnownProvider`** string (e.g. `anthropic`, `openai`, `xai`); full list and keys → [pi-agent-stack.md](./pi-agent-stack.md#llm-providers-pi-ai) |
| `LLM_MODEL` | `gpt-5.4-mini` | Must be a `getModel(LLM_PROVIDER, id)` id from `@mariozechner/pi-ai`. Not every id in the catalog is a good **tool** model — see [pi-agent-stack — LLM model ids and tool compatibility](./pi-agent-stack.md#llm-model-ids-and-tool-compatibility). |
| `ANTHROPIC_API_KEY` | — | Required when using Anthropic for the agent |
| `EXA_API_KEY` | — | `web_search` tool |
| `SUPADATA_API_KEY` | — | `fetch_page`, YouTube tools |
| `SYNC_INTERVAL_SECONDS` | `300` | Interval for `runFullSync` timer (**disabled when `BRAIN_DATA_ROOT` is set** until per-tenant background sync exists) |

### Agent LLM default (2026, staging and COGS)

Manual testing of **`gpt-5.4-mini`** has been strong for **simple** chat and tool use. **Staging** (`https://staging.braintunnel.ai` and the DigitalOcean stack) is moving to that model to control cost; **it is the server default** when `LLM_PROVIDER` / `LLM_MODEL` are unset (`openai` + `gpt-5.4-mini`). Treat this as **temporary** while we watch quality on harder workflows—override per environment or return to a larger model (e.g. `gpt-5.4` or Anthropic) when needed. Keys: set **`OPENAI_API_KEY`** (see table above).

Provider API keys follow `PROVIDER_API_KEY` conventions expected by `@mariozechner/pi-ai` / the agent.

---

*Back: [README.md](./README.md)*
