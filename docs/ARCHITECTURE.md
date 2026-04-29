# Architecture

High-level map of **brain-app** (Hono + Svelte + pi-agent-core). Roadmap: [OPPORTUNITIES.md](./OPPORTUNITIES.md). Issues: [BUGS.md](./BUGS.md).

**Detailed decision notes and deep dives** live in `**[docs/architecture/README.md](architecture/README.md)`**. This page stays an **index + short rationale** only.

---

## Overview

Personal assistant web app: **Chat** (agent), **Wiki** (markdown vault), **Inbox** (ripmail), served from one Node process.

```
Browser (Svelte 5)
  ↔  HTTP + SSE
Hono (Node 22)
  ├── /api/chat, /api/wiki, /api/files, /api/inbox, /api/calendar, /api/search, …
  ├── /api/skills, /api/onboarding
  ├── /api/imessage  (+ /api/messages alias)  — macOS, when chat.db readable
  └── /api/dev  — development only
```

Vite runs **inside** the same server in dev; production serves `dist/client`. See **[runtime and routes](architecture/runtime-and-routes.md)**.

---

## Testing

- **Server and `src/client/lib`**: Vitest with the **Node** environment; co-located `*.test.ts` (see [`vitest.config.ts`](../vitest.config.ts) `server` project).
- **Svelte components** (`src/client/components/*.test.ts`): Vitest **jsdom** project, `@testing-library/svelte`, shared mocks/fixtures under [`src/client/test/`](../src/client/test/). Details: **[component-testing.md](component-testing.md)**.

---

## Where to read next


| Topic                                                  | Doc                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Svelte component tests (Vitest, Testing Library)     | [component-testing.md](component-testing.md)                                   |
| Product vision, Karpathy “LLM Wiki” (wiki half) + ripmail (mail half) | [VISION.md](VISION.md) · [karpathy-llm-wiki-post.md](karpathy-llm-wiki-post.md) |
| HTTP routing, auth, periodic sync, native ports; SPA routes/overlays | [architecture/runtime-and-routes.md](architecture/runtime-and-routes.md)       |
| Client UI: latest-wins async / overlapping `fetch`    | [architecture/client-async-latest.md](architecture/client-async-latest.md)     |
| Desktop vs Cloud deployment models                    | [architecture/deployment-models.md](architecture/deployment-models.md)         |
| Multi-tenant cloud architecture (NAS, isolation)      | [architecture/multi-tenant-cloud-architecture.md](architecture/multi-tenant-cloud-architecture.md) |
| Tenant filesystem isolation (BUG-012, kernel + app)   | [architecture/tenant-filesystem-isolation.md](architecture/tenant-filesystem-isolation.md)         |
| Cloud-hosted v1 scope (Phase 0 parity)                  | [architecture/cloud-hosted-v1-scope.md](architecture/cloud-hosted-v1-scope.md) |
| **Staging deploy (DO droplet, registry, Watchtower)**  | [DEPLOYMENT.md](./DEPLOYMENT.md)                                               |
| **Security architecture and risk register**            | [SECURITY.md](./SECURITY.md)                                                   |
| Agent sessions, chat JSON files, SSE events, tool list | [architecture/agent-chat.md](architecture/agent-chat.md) · **Quick replies (chips):** [architecture/chat-suggestions.md](architecture/chat-suggestions.md) |
| Pi stack reference (`pi-agent-core` / `pi-ai` options, metering) | [architecture/pi-agent-stack.md](architecture/pi-agent-stack.md) · [OPP-043](opportunities/OPP-043-llm-usage-token-metering.md) |
| `$BRAIN_HOME` layout, wiki vs sync no-op, calendar ICS, starter wiki seed | [architecture/data-and-sync.md](architecture/data-and-sync.md)                 |
| Eval home, Enron fixture mail, index rebuild | [architecture/eval-home-and-mail-corpus.md](architecture/eval-home-and-mail-corpus.md) |
| Hosted Enron **demo** tenant (Bearer mint, Docker/staging QA) | [architecture/enron-demo-tenant.md](architecture/enron-demo-tenant.md) |
| Ripmail, unified search, files API, optional iMessage  | [architecture/integrations.md](architecture/integrations.md)                   |
| Environment variables                                  | [architecture/configuration.md](architecture/configuration.md)                 |
| **Local MLX LLM** (Apple Silicon, `mlx_lm.server`, Qwen 3.6) | [architecture/local-mlx-llm.md](architecture/local-mlx-llm.md) |
| Future SQLite consolidation (not current)              | [architecture/future-durability.md](architecture/future-durability.md)         |
| Wiki `read` vs `read_email` (indexed sources)            | [architecture/wiki-read-vs-read-email.md](architecture/wiki-read-vs-read-email.md) |
| Wiki-first memory vs managed memory (Honcho) — deferred | [architecture/wiki-vs-managed-memory-honcho.md](architecture/wiki-vs-managed-memory-honcho.md) |
| Ripmail crate internals                                | [ripmail/docs/ARCHITECTURE.md](../ripmail/docs/ARCHITECTURE.md)                |
| Brain network & inter-brain trust (strategy epic)      | [opportunities/OPP-042-brain-network-interbrain-trust-epic.md](opportunities/OPP-042-brain-network-interbrain-trust-epic.md) |


---

## Principles (short)

- **Single user, single process** — no separate API server; sessions are in-memory with chat history in JSON files under `$BRAIN_HOME/chats`.
- **Wiki is files** — agent tools from `@mariozechner/pi-coding-agent` are scoped to the wiki directory; brain-app does **not** auto-run git on the wiki (sync hook is a no-op for wiki).
  - **Email and index via ripmail** — subprocess CLI, `RIPMAIL_HOME` under Brain by default.
  - **UI Shell** — Svelte 5 SPA. The top-nav **Brain Hub widget** replaces legacy status bars and sync buttons, providing a single entry point to **Brain Hub** (`/hub`) for administration and system health.
  - **LLM** — `@mariozechner/pi-ai`, configured via env (see configuration doc). **Local MLX (Qwen on Apple Silicon):** [local-mlx-llm.md](architecture/local-mlx-llm.md).

---

## Deployment

**Primary release:** macOS **Braintunnel.app** (Tauri) — [OPP-007 (archived)](opportunities/archive/OPP-007-native-mac-app.md). **Hosted Linux container:** [OPP-041](opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md); local image via `Dockerfile` + [`docker-compose.yml`](../docker-compose.yml) (`.env` → `env_file`). **Current staging operations** (Droplet, `docker:publish`, Watchtower, OAuth limits): **[DEPLOYMENT.md](./DEPLOYMENT.md)**. **DigitalOcean staging** (April 2026): [`docker-compose.do.yml`](../docker-compose.do.yml), registry image, **`https://staging.braintunnel.ai`** (TLS at edge), durable volume for `/brain-data`. Archived [OPP-013](opportunities/archive/OPP-013-docker-deployment.md) explains why Docker is not the **desktop** substitute.

---

## Product and multi-tenant notes

**Hosted multi-tenant (`BRAIN_DATA_ROOT`):** Users **sign in with Google** (`/api/oauth/google/start`). The OAuth callback provisions (or rebinds) a workspace directory and issues the same **`brain_session`** cookie + tenant registry mapping as desktop sessions — **no vault password** in MT.

See [PRODUCTIZATION.md](./PRODUCTIZATION.md).