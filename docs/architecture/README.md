# Architecture — detailed docs

Brain-app overview and index: **[../ARCHITECTURE.md](../ARCHITECTURE.md)**. Product lineages: [VISION.md](../VISION.md), **[STRATEGY.md](../STRATEGY.md)** (positioning/moats), [Karpathy LLM Wiki (full text)](../karpathy-llm-wiki-post.md).

| Document | Topic |
|----------|--------|
| [web-app-source-reorganization-plan.md](./web-app-source-reorganization-plan.md) | Proposed `src/client` / `src/server` layout, phased migration, and oversized files to split (e.g. `agent/tools.ts`, large Svelte parents) |
| [../google-oauth.md](../google-oauth.md) | Gmail OAuth redirect URIs (dev `:3000` vs bundled `:18473`), Google Console registration |
| [runtime-and-routes.md](./runtime-and-routes.md) | Hono + Vite, `/api/*` map, auth, bundled listen address + Tailscale allowlist; SPA **`/c`**, **`/hub`**, **`?panel=`** overlays ([OPP-058](../opportunities/OPP-058-spa-url-main-pane-vs-overlay-query.md)) |
| [onboarding-state-machine.md](./onboarding-state-machine.md) | **First-run:** persisted `onboarding.json` states, transitions, phased mail backfill (30d then 1y), `GET /mail` poll vs ripmail lanes — [OPP-093 (archived)](../opportunities/archive/OPP-093-phased-onboarding-sync.md), [OPP-094](../opportunities/OPP-094-holistic-onboarding-background-task-orchestration.md), [OPP-054](../opportunities/OPP-054-guided-onboarding-agent.md) |
| [background-task-orchestration.md](./background-task-orchestration.md) | **`GET /api/background-status`**, wiki kick after `done`, orchestrator queue, supervisor reliability — implements [OPP-094](../opportunities/OPP-094-holistic-onboarding-background-task-orchestration.md) |
| [background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md) | **Mail refresh triggers**, no global `runFullSync` timer; **Your Wiki** single-loop-per-process model; **multi-tenant** scaling caveats (`loopRunning`, global `isPaused`) |
| [client-async-latest.md](./client-async-latest.md) | Svelte: `createAsyncLatest` — overlapping fetches must not clobber detail panes (agent nav, rapid clicks) |
| [cloud-hosted-v1-scope.md](./cloud-hosted-v1-scope.md) | Hosted Linux v1: API/SPA parity matrix, wiki-on-volume decision, OAuth redirect gap ([OPP-041](../opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md) Phase 0; [stub](../opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md)) |
| [deployment-models.md](./deployment-models.md) | **ADR:** Desktop vs cloud deployment; single codebase, two storage/auth layers; "both" strategy |
| [per-tenant-storage-defense.md](./per-tenant-storage-defense.md) | **ADR:** Directory-per-tenant storage (unconventional SaaS model); rationale, trade-offs, objections |
| [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md) | Cell-based hosted Brain with **S3 + container-local** (not NFS): one tenant per container (distributed locks), scaling phases (uber → locks → automated transitions → cells), cost estimates |
| **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)** | **S3-backed lifecycle detail:** startup (download snapshot, acquire lock), runtime (write-through wiki every edit, DB checkpoints every 5 min via VACUUM INTO), transitions (backup tar → S3, user offline 60–90s), crash recovery (wiki current, maildir re-sync from Gmail). DynamoDB lock design, failure modes. **[OPP-096](../opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md)** implementation. |
| [tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md) | Tenant FS isolation (micro-VM, POSIX UID, namespaces/Landlock, dir-FD caps, Workspace jail); **BUG-012** |
| [../DEPLOYMENT.md](../DEPLOYMENT.md) | **Staging deploy today:** Cloudflare `braintunnel.io`, DO droplet `braintunnel-staging`, registry + Watchtower, OAuth test-user cap, SSH-only host access |
| [../SECURITY.md](../SECURITY.md) | **Security architecture + open risks:** auth/session model, tenant isolation, shell injection finding, LLM data flows, P1–P13 (unaddressed only; hosting/snapshot policy in [DEPLOYMENT.md](../DEPLOYMENT.md)) |
| [../Dockerfile](../Dockerfile) / [../docker-compose.yml](../docker-compose.yml) / [../docker-compose.do.yml](../docker-compose.do.yml) | Local: `npm run docker:ripmail:build` + `BRAIN_HOME=/brain`. **DO staging:** registry image, `brain_data` volume, **`https://staging.braintunnel.ai`** (TLS at edge; :4000 in-container) ([OPP-041 (full)](../opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md), [digitalocean.md](../digitalocean.md), [DEPLOYMENT.md](../DEPLOYMENT.md)) |
| [agent-chat.md](./agent-chat.md) | pi-agent-core, chat persistence, SSE events, tools overview |
| [chat-suggestions.md](./chat-suggestions.md) | Quick reply chips: `suggest_reply_options` tool + suggest-reply repair (same path for main chat and onboarding interview) |
| [pi-agent-stack.md](./pi-agent-stack.md) | Pi packages reference (`pi-agent-core` / `pi-ai` / `pi-coding-agent`), Agent options; metering → [OPP-072](../opportunities/OPP-072-llm-usage-token-metering.md), NR telemetry + usage CLI → [OPP-071](../opportunities/OPP-071-llm-telemetry-traces-and-usage-cli.md) |
| [data-and-sync.md](./data-and-sync.md) | `$BRAIN_HOME` layout, wiki, calendar cache, ripmail refresh |
| [eval-home-and-mail-corpus.md](./eval-home-and-mail-corpus.md) | Eval home (`data-eval/brain`), Enron `kean-s` fixture pipeline, ripmail `.eml` rule, stamps — **living doc** |
| [enron-demo-tenant.md](./enron-demo-tenant.md) | **OPP-051 Phase 0:** hosted Enron fixture tenants, Bearer mint, CLI pre-seed + optional operator reseed, Docker/staging/automation |
| [local-mlx-llm.md](./local-mlx-llm.md) | **Apple Silicon:** run Qwen (etc.) via `mlx-lm` OpenAI-compatible server; `BRAIN_LLM=mlx-local/mlx-community/...`, `MLX_LOCAL_*` env |
| [integrations.md](./integrations.md) | Ripmail subprocess, `/api/search`, `/api/files`, optional iMessage; **trust boundaries** (ripmail vs `chat.db`) |
| [configuration.md](./configuration.md) | Environment variables |
| [chat-history-sqlite.md](./chat-history-sqlite.md) | Chat history → SQLite: current JSON-file limits, target schema, why now |
| [preferences-store.md](./preferences-store.md) | Preferences consolidation: scattered JSON files + localStorage → SQLite table + typed client module |
| [tailwind-migration.md](./tailwind-migration.md) | Tailwind-first client components; scoped CSS only where justified — [components README](../../src/client/components/README.md) |
| [calendar-write-path.md](./calendar-write-path.md) | Calendar writes: subprocess limitations; direct Google Calendar API as alternative for mutations |
| [agent-session-store.md](./agent-session-store.md) | Agent session Map: in-memory design, vault session race, horizontal-scale limits |
| [wiki-share-acl-and-projection-sync.md](./wiki-share-acl-and-projection-sync.md) | **ADR:** **`wiki_shares` ↔ `wikis/` symlink** ordering (grant **DB→FS**, revoke **FS→DB**); **fail-safe:** ambiguous failures → less grantee visibility, never more; reconcile; [OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md) |
| [wiki-sharing.md](./wiki-sharing.md) | **OPP-064** Phase 1 (archived spec) + **OPP-091** **`wikis/me`** layout — read-only wiki shares; companion to ADR above |
| [brain-to-brain-access-policy.md](./brain-to-brain-access-policy.md) | **Draft:** Cross-brain **access policy** — capabilities vs hard predicates (wiki paths, Ripmail-shaped mail filters) vs **soft fragments** (ALLOW/DISALLOW + facets), presets/library/grants, phasing vs Phase 0 textarea · **[OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** |
| [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md) | ADR: wiki file tools vs `read_mail_message` / `read_indexed_file` |
| [wiki-vs-managed-memory-honcho.md](./wiki-vs-managed-memory-honcho.md) | Recorded consideration: wiki-first memory vs Honcho (or similar); **not for now** |
| [external-data-sources.md](./external-data-sources.md) | Unified corpus: local FTS query layer, `sources[]` kinds (mail, localDir, cloud files, SaaS docs), sync vs query split, contentless file indexing, MCP as optional sync aid — **Google Drive:** [OPP-045](../opportunities/OPP-045-google-drive.md) |
| [brain-cloud-service.md](./brain-cloud-service.md) | Pre-opportunity notes: what a Brain-operated cloud service would contain (registry, support infra, tunnel relay) and the hard constraint that no user data ever leaves the local brain. **Brain-to-brain strategy:** [STRATEGY.md](../STRATEGY.md); product spec → [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) |

**Ripmail** (Rust CLI + index): [`../../ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md).

*Recorded considerations* are decisions or research notes that are **not** feature opportunities—they document why we chose a path or deferred an alternative, for future readers.
