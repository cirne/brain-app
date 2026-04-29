# Configuration and environment variables

Authoritative inline comments for a minimal dev setup: [`.env.example`](../../.env.example). The table below lists variables commonly used across the server, agent, and ripmail.

| Variable | Typical / default | Purpose |
|----------|-------------------|---------|
| `BRAIN_HOME` | `./data` (dev); `~/Library/Application Support/Brain` (bundled macOS) | Local root: chats, skills, ripmail, cache, `var/` — not the wiki vault on bundled macOS (see `BRAIN_WIKI_ROOT`). **Mutually exclusive with `BRAIN_DATA_ROOT`** (do not set both). |
| `BRAIN_DATA_ROOT` | — | **Multi-tenant cloud:** mounted volume root; each tenant home is **`$BRAIN_DATA_ROOT/<tenantUserId>/`** where `tenantUserId` is `usr_` + 20 lowercase alphanumerics (see `dataRoot.ts`). The **workspace handle** (URL-safe slug) lives in **`handle-meta.json`** inside that tree—derived from Gmail on OAuth sign-in, not the directory name. Stable identity ↔ tenant mapping (`google:<sub>`) lives in **`$BRAIN_DATA_ROOT/.global/tenant-registry.json`** together with **`brain_session`** routing. Hosted sign-in is **Google OAuth**; vault password endpoints are not used for normal MT users—see [google-oauth.md](../google-oauth.md). **Exception:** [Enron demo tenant](./enron-demo-tenant.md) (Bearer mint, fixture id) for staging/automation. Do not set `BRAIN_HOME` when this is set. See [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md). **DigitalOcean staging** ([`docker-compose.do.yml`](../../docker-compose.do.yml)): Docker named volume → **`/brain-data`**. **Breaking:** older previews used UUID directory names—reset or recreate the Docker volume rather than migrating. |
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
| `LLM_PROVIDER` | `openai` | Agent LLM: a `@mariozechner/pi-ai` **`KnownProvider`** (e.g. `anthropic`, `openai`, `xai`) or Brain-only **`mlx-local`** (local `mlx_lm.server`). Full list and keys → [pi-agent-stack.md](./pi-agent-stack.md#llm-providers-pi-ai) |
| `LLM_MODEL` | `gpt-5.4-mini` | Must resolve via `resolveModel(LLM_PROVIDER, id)` (pi-ai registry or `mlx-local` catalog in code). Not every id is a good **tool** model — see [pi-agent-stack — LLM model ids and tool compatibility](./pi-agent-stack.md#llm-model-ids-and-tool-compatibility). |
| `MLX_LOCAL_THINKING` | off | When `LLM_PROVIDER=mlx-local`: set `1` / `true` / `yes` to enable Qwen **extended thinking** (`chat_template_kwargs.enable_thinking`); unset = off (faster). See `.env.example` for `MLX_LOCAL_*` URLs and keys. |
| `ANTHROPIC_API_KEY` | — | Required when using Anthropic for the agent |
| `EXA_API_KEY` | — | `web_search` tool |
| `SUPADATA_API_KEY` | — | `fetch_page`, YouTube tools |
| `SYNC_INTERVAL_SECONDS` | `300` | Interval for `runFullSync` timer (**disabled when `BRAIN_DATA_ROOT` is set** until per-tenant background sync exists) |
| `BRAIN_ENRON_DEMO_SECRET` | — | **Hosted/demo only:** any non-empty value enables `POST /api/auth/demo/enron`, `GET /api/auth/demo/enron/seed-status`, and the `/demo` page (no link from hosted Google sign-in). Bearer must match (timing-safe). See [enron-demo-tenant.md](./enron-demo-tenant.md). |
| `BRAIN_ENRON_DEMO_TENANT_ID` | `usr_enrondemo00000000001` | Fixed demo tenant directory under `BRAIN_DATA_ROOT`; override for tests. |
| `EVAL_ENRON_TAR` | — | Optional: path to `enron_mail_20150507.tar.gz`. If unset, **`npm run eval:build`** and **`npm run brain:seed-enron-demo`** download once (SHA-checked) to **`data-eval/.cache/enron/enron_mail_20150507.tar.gz`** (or lazy-seed checks that path before `tmpdir`). |
| `BRAIN_SEED_REPO_ROOT` | — | **Lazy seed only:** repo root containing `eval/fixtures/enron-kean-manifest.json` (defaults: `/app/seed-enron` in image, else `process.cwd()`). |
| `ENRON_SOURCE_URL` / `ENRON_SHA256` | — | Override CMU tarball URL/hash when downloading (air-gapped mirrors). Used by **`npm run eval:build`**, demo seed, and lazy-seed. |

### Agent LLM default (2026, staging and COGS)

Manual testing of **`gpt-5.4-mini`** has been strong for **simple** chat and tool use. **Staging** (`https://staging.braintunnel.ai` and the DigitalOcean stack) is moving to that model to control cost; **it is the server default** when `LLM_PROVIDER` / `LLM_MODEL` are unset (`openai` + `gpt-5.4-mini`). Treat this as **temporary** while we watch quality on harder workflows—override per environment or return to a larger model (e.g. `gpt-5.4` or Anthropic) when needed. Keys: set **`OPENAI_API_KEY`** (see table above).

Provider API keys follow `PROVIDER_API_KEY` conventions expected by `@mariozechner/pi-ai` / the agent.

---

*Back: [README.md](./README.md)*
