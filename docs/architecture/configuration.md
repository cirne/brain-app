# Configuration and environment variables

Authoritative inline comments for a minimal dev setup: [`.env.example`](../../.env.example). The table below lists variables commonly used across the server, agent, and ripmail.

| Variable | Typical / default | Purpose |
|----------|-------------------|---------|
| `BRAIN_HOME` | `./data` (dev); `~/Library/Application Support/Brain` (bundled macOS) | Local root: chats, skills, ripmail, cache, `var/` — not the wiki vault on bundled macOS (see `BRAIN_WIKI_ROOT`) |
| `BRAIN_WIKI_ROOT` | `~/Documents/Brain` (bundled macOS when unset) | Parent directory of the `wiki/` folder (`$BRAIN_WIKI_ROOT/wiki`). Dev / non-macOS: same as `BRAIN_HOME` when unset. Set by Tauri on macOS; ignored from `.env` when bundled. |
| `BRAIN_BUNDLED_NATIVE` | — | Set to `1` by Tauri when spawning the bundled server |
| `BRAIN_EMBED_MASTER_KEY` | — | Tauri release: encrypt allowlisted secrets embedded in the native binary (LLM/tool keys + optional `GOOGLE_OAUTH_*` for packaged Gmail OAuth) |
| `NODE_ENV` | `development` / `production` | Controls build-time behavior for Vite/esbuild (vault session applies in dev and prod) |
| `PORT` | `3000` | Listen port for dev / non-bundled `node dist/server` (must match [Gmail OAuth redirect](../google-oauth.md)); bundled app uses `18473` on **`0.0.0.0`** ([Tailscale / LAN policy](./runtime-and-routes.md#tailscale--remote-access-bundled-only)) |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail executable |
| `RIPMAIL_HOME` | `$BRAIN_HOME/ripmail` | Ripmail data dir when unset in Brain |
| `RIPMAIL_EMAIL_ADDRESS` / `RIPMAIL_IMAP_PASSWORD` | — | Non-interactive ripmail setup |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | — | In-app Gmail OAuth ([docs/google-oauth.md](../google-oauth.md)); redirect URI is fixed in code. For **Brain.app**, set in `.env` when building with `BRAIN_EMBED_MASTER_KEY` so they are embedded like other allowlisted secrets (GUI apps do not load shell `.env`). |
| `RIPMAIL_GOOGLE_OAUTH_CLIENT_ID` / `RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET` | — | Ripmail token refresh; if unset, Brain maps from `GOOGLE_OAUTH_*` in `ripmailProcessEnv` |
| `OPENAI_API_KEY` | — | Ripmail validation / optional ripmail LLM features |
| `LLM_PROVIDER` | `anthropic` | Agent LLM provider (`anthropic`, `openai`, …) |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Agent model id |
| `ANTHROPIC_API_KEY` | — | Required when using Anthropic for the agent |
| `EXA_API_KEY` | — | `web_search` tool |
| `SUPADATA_API_KEY` | — | `fetch_page`, YouTube tools |
| `SYNC_INTERVAL_SECONDS` | `300` | Interval for `runFullSync` timer |

Provider API keys follow `PROVIDER_API_KEY` conventions expected by `@mariozechner/pi-ai` / the agent.

---

*Back: [README.md](./README.md)*
