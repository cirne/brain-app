# Architecture

High-level map of **brain-app** (Hono + Svelte + pi-agent-core). Roadmap: [OPPORTUNITIES.md](./OPPORTUNITIES.md). Issues: [BUGS.md](./BUGS.md).

**Detailed decision notes and deep dives** live in **[docs/architecture/README.md](architecture/README.md)**. Below, further reading is **grouped by topic** with a small table per group; this page stays **index + short rationale** beyond that.

---

## Overview

Personal assistant web app: **Chat** (agent), **Wiki** (markdown vault), **Inbox** (indexed mail in **`src/server/ripmail/`**), served from one Node process.

**Architectural risk review (CTO lens):** [architecture/cto-architectural-risk-review.md](architecture/cto-architectural-risk-review.md) — outside-view assessment of decisions that are cheap to revisit now but expensive once we have paying users (schema migrations, idempotency, deletion pipeline, credential storage, agent prompt-injection envelope, per-tenant LLM budgets, audit log, B2B cross-tenant write coupling).

```
Browser (Svelte 5)
  ↔  HTTP + SSE
Hono (Node 22)
  ├── /api/chat, /api/chat/b2b (Braintunnel B2B), /api/notifications, /api/wiki (+ `/api/wiki/shared/…` for cross-tenant read shares), `/api/wiki-shares`, /api/files, /api/inbox, /api/calendar, /api/search, …
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
| Wiki sharing / brain-to-brain collaborators | [ideas/archive/IDEA-wiki-sharing-collaborators.md](ideas/archive/IDEA-wiki-sharing-collaborators.md) · **Phase 1 shipped:** [architecture/wiki-sharing.md](architecture/wiki-sharing.md) ([archived OPP-064](opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md)) · **Layout follow-on:** [OPP-091](opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md) · **Chat-native B2B (Tunnels):** [architecture/braintunnel-b2b-chat.md](architecture/braintunnel-b2b-chat.md) · **Cross-brain access policy (draft):** [architecture/brain-to-brain-access-policy.md](architecture/brain-to-brain-access-policy.md) |
| Hosted cloud v1 scope (Phase 0 parity)      | [architecture/cloud-hosted-v1-scope.md](architecture/cloud-hosted-v1-scope.md)       |


---

## Hosting, tenancy, and operations

Deployment topology, isolation, staging, and formal security posture.


| Topic                                                           | Doc                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Desktop vs cloud deployment models                              | [architecture/deployment-models.md](architecture/deployment-models.md)                             |
| **Directory-per-tenant storage (ADR, defense)**                 | [architecture/per-tenant-storage-defense.md](architecture/per-tenant-storage-defense.md)           |
| **Backup & restore (ZIP: wiki history vs full tenant / S3)**    | [architecture/backup-restore.md](architecture/backup-restore.md)                                   |
| **Multi-tenant cloud architecture (S3 + local, locks)**          | [architecture/multi-tenant-cloud-architecture.md](architecture/multi-tenant-cloud-architecture.md) · **Multi-container / tenant LB:** [architecture/multi-container-architecture.md](architecture/multi-container-architecture.md) · B2B tunnel **cross-cell** follow-on → [chat-history-sqlite.md § B2B](architecture/chat-history-sqlite.md#b2b-cross-tenant-writes-and-cell-scaling) |
| **Cloud tenant lifecycle (S3 backup, transitions, recovery)**   | [architecture/cloud-tenant-lifecycle.md](architecture/cloud-tenant-lifecycle.md) · **[OPP-096](opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md)** |
| Tenant filesystem isolation (BUG-012, kernel + app)             | [architecture/tenant-filesystem-isolation.md](architecture/tenant-filesystem-isolation.md)         |
| **Staging deploy** (DigitalOcean droplet, registry, Watchtower) | [DEPLOYMENT.md](./DEPLOYMENT.md)                                                                   |
| **Security architecture and risk register**                     | [SECURITY.md](./SECURITY.md)                                                                       |
| **CTO architectural risk review** (cheap-now / expensive-later) | [architecture/cto-architectural-risk-review.md](architecture/cto-architectural-risk-review.md)     |


---

## Runtime, SPA stack, and local development

How the unified server behaves, how the client is exercised in tests, and environment wiring.


| Topic                                                                    | Doc                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| HTTP routing, auth, background sync & supervisor model, native ports; SPA routes and overlays | [architecture/runtime-and-routes.md](architecture/runtime-and-routes.md) · **[background-sync-and-supervisor-scaling.md](architecture/background-sync-and-supervisor-scaling.md)** · **Onboarding states + mail phases:** [architecture/onboarding-state-machine.md](architecture/onboarding-state-machine.md)   |
| Web i18n architecture (i18next, JSON namespaces, testing model)          | [architecture/i18n.md](architecture/i18n.md)                               |
| Environment variables and config surface                                 | **[architecture/environment-variables.md](architecture/environment-variables.md)** (full inventory; contributor rule) · [architecture/configuration.md](architecture/configuration.md) (narrative + table) |
| Svelte component tests (Vitest, Testing Library)                         | [component-testing.md](component-testing.md)                               |
| Client UI: latest-wins async / overlapping `fetch`                       | [architecture/client-async-latest.md](architecture/client-async-latest.md) |
| **Packaged macOS app (Tauri, experimental)** — DMG, bundled server, embed keys | [architecture/desktop-tauri-experimental.md](architecture/desktop-tauri-experimental.md) · **Logs / FDA / ports:** [.agents/skills/desktop/SKILL.md](../.agents/skills/desktop/SKILL.md) |


---

## Agent stack and inference

Chat transport, tooling surface, Pi integration, metering hooks, and local model serving.


| Topic                                                    | Doc                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agent sessions, chat + SQLite persistence (`var/brain-tenant.sqlite`), SSE, tool catalog | [architecture/agent-chat.md](architecture/agent-chat.md)                                                                        |
| **Braintunnel B2B chat** (tunnels, `/api/chat/b2b`, cross-tenant session writes) | [architecture/braintunnel-b2b-chat.md](architecture/braintunnel-b2b-chat.md) · grants: [architecture/brain-query-delegation.md](architecture/brain-query-delegation.md) |
| Quick replies (chips / suggestions UI)                   | [architecture/chat-suggestions.md](architecture/chat-suggestions.md)                                                            |
| Pi stack (`pi-agent-core` / `pi-ai`, options, metering)  | [architecture/pi-agent-stack.md](architecture/pi-agent-stack.md) · [OPP-072](opportunities/archive/OPP-072-llm-usage-token-metering.md) |
| Local MLX LLM (Apple Silicon, `mlx_lm.server`, Qwen 3.6) | [architecture/local-mlx-llm.md](architecture/local-mlx-llm.md)                                                                  |


---

## Data plane: `$BRAIN_HOME`, mail (ripmail layout), search, corpora

On-disk layout, integrations, evaluations, and the **TypeScript** mail stack (**`src/server/ripmail/`**, in-process `better-sqlite3` on each tenant’s **`ripmail/`** tree per [`brain-layout.json`](../shared/brain-layout.json)).


| Topic                                                                         | Doc                                                                                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `$BRAIN_HOME` layout, wiki vs sync no-op, calendar ICS, starter wiki          | [architecture/data-and-sync.md](architecture/data-and-sync.md)                                                                    |
| **First-run onboarding** (persisted states, phased mail sync, `/api/onboarding`) | [architecture/onboarding-state-machine.md](architecture/onboarding-state-machine.md)                                            |
| Mail (`@server/ripmail`), unified search, files API, optional iMessage              | [architecture/integrations.md](architecture/integrations.md)                                                                      |
| Wiki `read` vs indexed mail/files (`read_mail_message` / `read_indexed_file`) | [architecture/wiki-read-vs-read-email.md](architecture/wiki-read-vs-read-email.md)                                                |
| External corpus (Drive + SaaS remote docs, mail, `localDir`, local-first FTS)   | [architecture/external-data-sources.md](architecture/external-data-sources.md) · [archived OPP-045](opportunities/archive/OPP-045-google-drive.md) |
| Eval home, Enron fixture mail, search index rebuild                           | [architecture/eval-home-and-mail-corpus.md](architecture/eval-home-and-mail-corpus.md)                                            |
| Hosted Enron **demo** tenant (Bearer mint, Docker / staging QA)               | [architecture/enron-demo-tenant.md](architecture/enron-demo-tenant.md)                                                            |
| **Rust ripmail — archaeology** (annotated git tags; last tree before crate left `main`) | [architecture/ripmail-rust-snapshot.md](architecture/ripmail-rust-snapshot.md) · [archived OPP-105](opportunities/archive/OPP-105-ripmail-rust-pre-typescript-git-snapshot.md) |
| **Mail in-process** (TS ripmail; Rust crate archaeology)                               | [archived OPP-103](opportunities/archive/OPP-103-ripmail-ts-port.md) · [OPP-108](opportunities/OPP-108-unified-tenant-sqlite.md) (merge to one tenant DB)                     |


---

## Known architectural issues

Limits, split stores, unfinished migrations, or deferred directions — overlap with [BUGS.md](./BUGS.md) and [OPPORTUNITIES.md](./OPPORTUNITIES.md).

### Persistence and preference storage


| Topic                                                                   | Doc                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Chat + app notifications: tenant SQLite (`var/brain-tenant.sqlite`); mail index in tenant **`ripmail/`** (separate SQLite today; merge follow-on [OPP-108](opportunities/OPP-108-unified-tenant-sqlite.md)); **Postgres deferred** — rationale in same doc | [architecture/chat-history-sqlite.md](architecture/chat-history-sqlite.md) |
| Preferences scattered across JSON + `localStorage`                      | [architecture/preferences-store.md](architecture/preferences-store.md)     |


### UI stack and calendars


| Topic                                                       | Doc                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
- **Tailwind in the build; Tailwind-first components** | [architecture/tailwind-migration.md](architecture/tailwind-migration.md)   |
| Calendar (in-process `@server/ripmail`; historical subprocess-era notes) | [architecture/calendar-write-path.md](architecture/calendar-write-path.md) |


### Sessions and long-term architecture


| Topic                                                   | Doc                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Agent session store (in-memory `Map`; horizontal scale) | [architecture/agent-session-store.md](architecture/agent-session-store.md)                     |
| Wiki-first memory vs managed memory (Honcho) — deferred | [architecture/wiki-vs-managed-memory-honcho.md](architecture/wiki-vs-managed-memory-honcho.md) |


---

## Principles (short)

- **Single user, single process** — no separate API server; sessions are in-memory with chat history persisted in **`var/brain-tenant.sqlite`** per tenant (see [chat-history-sqlite.md](architecture/chat-history-sqlite.md)); **`chats/`** retains onboarding JSON only.
- **Wiki is files** — agent tools from `@earendil-works/pi-coding-agent` are scoped to the wiki directory; brain-app does **not** auto-run git on the wiki (sync hook is a no-op for wiki).
  - **Bootstrap then maintenance** — after enough indexed mail, a **one-shot wiki bootstrap** may create bounded first-draft stubs ([archived OPP-095](opportunities/archive/OPP-095-wiki-first-draft-bootstrap.md)); the **Your Wiki** supervisor then runs enrich → cleanup laps ([architecture/your-wiki-background-pipeline.md](architecture/your-wiki-background-pipeline.md); status HTTP in [background-task-orchestration.md](architecture/background-task-orchestration.md)).
  - **Email and mail index** — **`src/server/ripmail/`** (TypeScript, in-process); on-disk **`ripmail/`** layout under each tenant home ([`brain-layout.json`](../shared/brain-layout.json)). See [architecture/integrations.md](architecture/integrations.md).
  - **UI Shell** — Svelte 5 SPA. The top-nav **Brain Hub widget** replaces legacy status bars and sync buttons, providing a single entry point to **Brain Hub** (`/hub`) for administration and system health.
  - **LLM** — `@earendil-works/pi-ai`, configured via env (see configuration doc). **Local MLX (Qwen on Apple Silicon):** [local-mlx-llm.md](architecture/local-mlx-llm.md).

---

## Deployment

**Primary release:** macOS **Braintunnel.app** (Tauri) — [OPP-007 (archived)](opportunities/archive/OPP-007-native-mac-app.md). **Hosted Linux container:** [archived OPP-041](opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md); local image via `Dockerfile` + `[docker-compose.yml](../docker-compose.yml)` (`.env` → `env_file`). **Current staging operations** (Droplet, `docker:deploy`, Watchtower, OAuth limits): **[DEPLOYMENT.md](./DEPLOYMENT.md)**. **DigitalOcean staging** (April 2026): [docker-compose.do.yml](../docker-compose.do.yml), registry image, **[https://staging.braintunnel.ai](https://staging.braintunnel.ai)** (TLS at edge), durable volume for `/brain-data`. Archived [OPP-013](opportunities/archive/OPP-013-docker-deployment.md) explains why Docker is not the **desktop** substitute.

---

## Product and multi-tenant notes

**Hosted multi-tenant (`BRAIN_DATA_ROOT`):** Users **sign in with Google** (`/api/oauth/google/start`). The OAuth callback provisions (or rebinds) a workspace directory and issues the same **brain_session** cookie + tenant registry mapping as desktop sessions — **no vault password** in MT.

See [PRODUCTIZATION.md](./PRODUCTIZATION.md).