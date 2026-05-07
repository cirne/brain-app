# Architecture

High-level map of **brain-app** (Hono + Svelte + pi-agent-core). Roadmap: [OPPORTUNITIES.md](./OPPORTUNITIES.md). Issues: [BUGS.md](./BUGS.md).

**Detailed decision notes and deep dives** live in **[docs/architecture/README.md](architecture/README.md)**. Below, further reading is **grouped by topic** with a small table per group; this page stays **index + short rationale** beyond that.

---

## Overview

Personal assistant web app: **Chat** (agent), **Wiki** (markdown vault), **Inbox** (ripmail), served from one Node process.

```
Browser (Svelte 5)
  ↔  HTTP + SSE
Hono (Node 22)
  ├── /api/chat, /api/wiki (+ `/api/wiki/shared/…` for cross-tenant read shares), `/api/wiki-shares`, /api/files, /api/inbox, /api/calendar, /api/search, …
  ├── /api/skills, /api/onboarding
  ├── /api/imessage  (+ /api/messages alias)  — macOS, when chat.db readable
  └── /api/dev  — development only
```

Vite runs **inside** the same server in dev; production serves `dist/client`. See **[runtime and routes](architecture/runtime-and-routes.md)**.

---

## Testing

- **Server and `src/client/lib`**: Vitest with the **Node** environment; co-located `*.test.ts` (see `[vitest.config.ts](../vitest.config.ts)` `server` project).
- **Svelte components** (`src/client/components/*.test.ts`): Vitest **jsdom** project, `@testing-library/svelte`, shared mocks/fixtures under `[src/client/test/](../src/client/test/)`. Details: **[component-testing.md](component-testing.md)**.

---

## Vision, strategy, and product narrative

Why the product exists, how we talk about it, and collaboration ideas — not routing or hosting mechanics.


| Topic                                       | Doc                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Product vision (wiki + inbox narrative)     | [VISION.md](VISION.md)                                                               |
| Strategy: segments and moats                | [STRATEGY.md](STRATEGY.md)                                                           |
| Open: narrow JTBD + category-label analysis (May 2026) | [the-product-question.md](the-product-question.md)                        |
| Open: is the wiki worth maintaining?        | [the-wiki-question.md](the-wiki-question.md)                                         |
| Karpathy *LLM Wiki* (wiki half of the idea) | [karpathy-llm-wiki-post.md](karpathy-llm-wiki-post.md)                               |
| Wiki sharing / brain-to-brain collaborators | [ideas/IDEA-wiki-sharing-collaborators.md](ideas/IDEA-wiki-sharing-collaborators.md) · **Phase 1 shipped:** [architecture/wiki-sharing.md](architecture/wiki-sharing.md) ([OPP-064 stub](opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md), [archived spec](opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md)) · **Layout follow-on:** [OPP-091](opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md) |
| Hosted cloud v1 scope (Phase 0 parity)      | [architecture/cloud-hosted-v1-scope.md](architecture/cloud-hosted-v1-scope.md)       |


---

## Hosting, tenancy, and operations

Deployment topology, isolation, staging, and formal security posture.


| Topic                                                           | Doc                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Desktop vs cloud deployment models                              | [architecture/deployment-models.md](architecture/deployment-models.md)                             |
| **Directory-per-tenant storage (ADR, defense)**                 | [architecture/per-tenant-storage-defense.md](architecture/per-tenant-storage-defense.md)           |
| **Multi-tenant cloud architecture (S3 + local, locks)**          | [architecture/multi-tenant-cloud-architecture.md](architecture/multi-tenant-cloud-architecture.md) |
| **Cloud tenant lifecycle (S3 backup, transitions, recovery)**   | [architecture/cloud-tenant-lifecycle.md](architecture/cloud-tenant-lifecycle.md) · **[OPP-096](opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md)** |
| Tenant filesystem isolation (BUG-012, kernel + app)             | [architecture/tenant-filesystem-isolation.md](architecture/tenant-filesystem-isolation.md)         |
| **Staging deploy** (DigitalOcean droplet, registry, Watchtower) | [DEPLOYMENT.md](./DEPLOYMENT.md)                                                                   |
| **Security architecture and risk register**                     | [SECURITY.md](./SECURITY.md)                                                                       |


---

## Runtime, SPA stack, and local development

How the unified server behaves, how the client is exercised in tests, and environment wiring.


| Topic                                                                    | Doc                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| HTTP routing, auth, background sync & supervisor model, native ports; SPA routes and overlays | [architecture/runtime-and-routes.md](architecture/runtime-and-routes.md) · **[background-sync-and-supervisor-scaling.md](architecture/background-sync-and-supervisor-scaling.md)** · **Onboarding states + mail phases:** [architecture/onboarding-state-machine.md](architecture/onboarding-state-machine.md)   |
| Environment variables and config surface                                 | [architecture/configuration.md](architecture/configuration.md)             |
| Svelte component tests (Vitest, Testing Library)                         | [component-testing.md](component-testing.md)                               |
| Client UI: latest-wins async / overlapping `fetch`                       | [architecture/client-async-latest.md](architecture/client-async-latest.md) |


---

## Agent stack and inference

Chat transport, tooling surface, Pi integration, metering hooks, and local model serving.


| Topic                                                    | Doc                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agent sessions, chat JSON persistence, SSE, tool catalog | [architecture/agent-chat.md](architecture/agent-chat.md)                                                                        |
| Quick replies (chips / suggestions UI)                   | [architecture/chat-suggestions.md](architecture/chat-suggestions.md)                                                            |
| Pi stack (`pi-agent-core` / `pi-ai`, options, metering)  | [architecture/pi-agent-stack.md](architecture/pi-agent-stack.md) · [OPP-072](opportunities/OPP-072-llm-usage-token-metering.md) |
| Local MLX LLM (Apple Silicon, `mlx_lm.server`, Qwen 3.6) | [architecture/local-mlx-llm.md](architecture/local-mlx-llm.md)                                                                  |


---

## Data plane: `$BRAIN_HOME`, ripmail, search, corpora

On-disk layout, integrations, evaluations, and the Rust inbox implementation.


| Topic                                                                         | Doc                                                                                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `$BRAIN_HOME` layout, wiki vs sync no-op, calendar ICS, starter wiki          | [architecture/data-and-sync.md](architecture/data-and-sync.md)                                                                    |
| **First-run onboarding** (persisted states, phased mail sync, `/api/onboarding`) | [architecture/onboarding-state-machine.md](architecture/onboarding-state-machine.md)                                            |
| Ripmail subprocess, unified search, files API, optional iMessage              | [architecture/integrations.md](architecture/integrations.md)                                                                      |
| Wiki `read` vs indexed mail/files (`read_mail_message` / `read_indexed_file`) | [architecture/wiki-read-vs-read-email.md](architecture/wiki-read-vs-read-email.md)                                                |
| External corpus (Drive, SaaS docs, local-first index)                         | [architecture/external-data-sources.md](architecture/external-data-sources.md) · [OPP-045](opportunities/OPP-045-google-drive.md) |
| Eval home, Enron fixture mail, search index rebuild                           | [architecture/eval-home-and-mail-corpus.md](architecture/eval-home-and-mail-corpus.md)                                            |
| Hosted Enron **demo** tenant (Bearer mint, Docker / staging QA)               | [architecture/enron-demo-tenant.md](architecture/enron-demo-tenant.md)                                                            |
| Ripmail crate (Rust internals)                                                | [ripmail/docs/ARCHITECTURE.md](../ripmail/docs/ARCHITECTURE.md)                                                                   |


---

## Known architectural issues

Limits, split stores, unfinished migrations, or deferred directions — overlap with [BUGS.md](./BUGS.md) and [OPPORTUNITIES.md](./OPPORTUNITIES.md).

### Persistence and preference storage


| Topic                                                                   | Doc                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Chat history as JSON files; SQLite direction (perf and search ceilings) | [architecture/chat-history-sqlite.md](architecture/chat-history-sqlite.md) |
| Preferences scattered across JSON + `localStorage`                      | [architecture/preferences-store.md](architecture/preferences-store.md)     |


### UI stack and calendars


| Topic                                                       | Doc                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
- **Tailwind in the build; Tailwind-first components** | [architecture/tailwind-migration.md](architecture/tailwind-migration.md)   |
| Calendar writes: subprocess vs direct Google Calendar API   | [architecture/calendar-write-path.md](architecture/calendar-write-path.md) |


### Sessions and long-term architecture


| Topic                                                   | Doc                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Agent session store (in-memory `Map`; horizontal scale) | [architecture/agent-session-store.md](architecture/agent-session-store.md)                     |
| Wiki-first memory vs managed memory (Honcho) — deferred | [architecture/wiki-vs-managed-memory-honcho.md](architecture/wiki-vs-managed-memory-honcho.md) |


---

## Principles (short)

- **Single user, single process** — no separate API server; sessions are in-memory with chat history persisted under `$BRAIN_HOME` (see [chat-history-sqlite.md](architecture/chat-history-sqlite.md) for the planned SQLite migration).
- **Wiki is files** — agent tools from `@mariozechner/pi-coding-agent` are scoped to the wiki directory; brain-app does **not** auto-run git on the wiki (sync hook is a no-op for wiki).
  - **Bootstrap then maintenance** — after enough indexed mail, a **one-shot wiki bootstrap** may create bounded first-draft stubs ([OPP-095](opportunities/OPP-095-wiki-first-draft-bootstrap.md)); the **Your Wiki** supervisor then runs deepen-only laps ([architecture/background-task-orchestration.md](architecture/background-task-orchestration.md)).
  - **Email and index via ripmail** — subprocess CLI, `RIPMAIL_HOME` under Brain by default.
  - **UI Shell** — Svelte 5 SPA. The top-nav **Brain Hub widget** replaces legacy status bars and sync buttons, providing a single entry point to **Brain Hub** (`/hub`) for administration and system health.
  - **LLM** — `@mariozechner/pi-ai`, configured via env (see configuration doc). **Local MLX (Qwen on Apple Silicon):** [local-mlx-llm.md](architecture/local-mlx-llm.md).

---

## Deployment

**Primary release:** macOS **Braintunnel.app** (Tauri) — [OPP-007 (archived)](opportunities/archive/OPP-007-native-mac-app.md). **Hosted Linux container:** [OPP-041](opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md); local image via `Dockerfile` + `[docker-compose.yml](../docker-compose.yml)` (`.env` → `env_file`). **Current staging operations** (Droplet, `docker:deploy`, Watchtower, OAuth limits): **[DEPLOYMENT.md](./DEPLOYMENT.md)**. **DigitalOcean staging** (April 2026): [docker-compose.do.yml](../docker-compose.do.yml), registry image, **[https://staging.braintunnel.ai](https://staging.braintunnel.ai)** (TLS at edge), durable volume for `/brain-data`. Archived [OPP-013](opportunities/archive/OPP-013-docker-deployment.md) explains why Docker is not the **desktop** substitute.

---

## Product and multi-tenant notes

**Hosted multi-tenant (`BRAIN_DATA_ROOT`):** Users **sign in with Google** (`/api/oauth/google/start`). The OAuth callback provisions (or rebinds) a workspace directory and issues the same **brain_session** cookie + tenant registry mapping as desktop sessions — **no vault password** in MT.

See [PRODUCTIZATION.md](./PRODUCTIZATION.md).