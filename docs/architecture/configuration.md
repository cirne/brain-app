# Configuration and environment variables

Authoritative inline comments for a minimal dev setup: [`.env.example`](../../.env.example). The table below lists variables commonly used across the server, agent, and ripmail.

| Variable | Typical / default | Purpose |
|----------|-------------------|---------|
| `BRAIN_HOME` | `./data` (dev) | Root for wiki, chats, skills, ripmail, cache, var |
| `BRAIN_BUNDLED_NATIVE` | — | Set to `1` by Tauri when spawning the bundled server |
| `BRAIN_EMBED_MASTER_KEY` | — | Tauri release: encrypt API keys embedded in the native binary |
| `NODE_ENV` | `development` / `production` | Skips API auth in dev when not production |
| `AUTH_USER` / `AUTH_PASS` | `lew` / `changeme` | Basic auth for `/api/*` in production |
| `AUTH_DISABLED` | — | `true` disables Basic Auth in production |
| `PORT` | `18473` | Listen port (non-bundled production and dev; must match [Gmail OAuth redirect](../google-oauth.md)) |
| `RIPMAIL_BIN` | `ripmail` | Path to ripmail executable |
| `RIPMAIL_HOME` | `$BRAIN_HOME/ripmail` | Ripmail data dir when unset in Brain |
| `RIPMAIL_EMAIL_ADDRESS` / `RIPMAIL_IMAP_PASSWORD` | — | Non-interactive ripmail setup |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | — | In-app Gmail OAuth ([docs/google-oauth.md](../google-oauth.md)); redirect URI is fixed in code |
| `RIPMAIL_GOOGLE_OAUTH_CLIENT_ID` / `RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET` | — | Ripmail token refresh; if unset, Brain maps from `GOOGLE_OAUTH_*` in `ripmailProcessEnv` |
| `OPENAI_API_KEY` | — | Ripmail validation / optional ripmail LLM features |
| `LLM_PROVIDER` | `anthropic` | Agent LLM provider (`anthropic`, `openai`, …) |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Agent model id |
| `ANTHROPIC_API_KEY` | — | Required when using Anthropic for the agent |
| `EXA_API_KEY` | — | `web_search` tool |
| `SUPADATA_API_KEY` | — | `fetch_page`, YouTube tools |
| `CIRNE_TRAVEL_ICS_URL` / `LEW_PERSONAL_ICS_URL` | — | Calendar ICS feeds for cache refresh |
| `SYNC_INTERVAL_SECONDS` | `300` | Interval for `runFullSync` timer |

Provider API keys follow `PROVIDER_API_KEY` conventions expected by `@mariozechner/pi-ai` / the agent.

---

*Back: [README.md](./README.md)*
