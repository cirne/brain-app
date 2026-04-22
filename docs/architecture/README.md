# Architecture — detailed docs

Brain-app overview and index: **[../ARCHITECTURE.md](../ARCHITECTURE.md)**.

| Document | Topic |
|----------|--------|
| [../google-oauth.md](../google-oauth.md) | Gmail OAuth redirect URIs (dev `:3000` vs bundled `:18473`), Google Console registration |
| [runtime-and-routes.md](./runtime-and-routes.md) | Hono + Vite, `/api/*` map, auth, bundled listen address + Tailscale allowlist, periodic sync |
| [cloud-hosted-v1-scope.md](./cloud-hosted-v1-scope.md) | Hosted Linux v1: API/SPA parity matrix, wiki-on-volume decision, OAuth redirect gap ([OPP-041](../opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md) Phase 0) |
| [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md) | Cell-based hosted Brain: one tenant / one home, NAS, scaling phases, guardrails |
| [tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md) | Tenant FS isolation (micro-VM, POSIX UID, namespaces/Landlock, dir-FD caps, Workspace jail); **BUG-012** |
| [../Dockerfile](../Dockerfile) / [../docker-compose.yml](../docker-compose.yml) / [../docker-compose.do.yml](../docker-compose.do.yml) | Local: `npm run docker:ripmail:build` + `BRAIN_HOME=/brain`. **DO staging:** registry image, `brain_data` volume, HTTP :4000 ([OPP-041](../opportunities/OPP-041-hosted-cloud-epic-docker-digitalocean.md), [digitalocean.md](../digitalocean.md)) |
| [agent-chat.md](./agent-chat.md) | pi-agent-core, chat persistence, SSE events, tools overview |
| [data-and-sync.md](./data-and-sync.md) | `$BRAIN_HOME` layout, wiki, calendar cache, ripmail refresh |
| [integrations.md](./integrations.md) | Ripmail subprocess, `/api/search`, `/api/files`, optional iMessage; **trust boundaries** (ripmail vs `chat.db`) |
| [configuration.md](./configuration.md) | Environment variables |
| [future-durability.md](./future-durability.md) | Possible future SQLite for app-owned state |
| [wiki-read-vs-read-doc.md](./wiki-read-vs-read-doc.md) | ADR: wiki file tools vs `read_doc` |
| [wiki-vs-managed-memory-honcho.md](./wiki-vs-managed-memory-honcho.md) | Recorded consideration: wiki-first memory vs Honcho (or similar); **not for now** |
| [external-sources-and-mcp.md](./external-sources-and-mcp.md) | Strategy: MCP as sync transport (not query API); local-first indexing for remote mutable sources (Notion, Linear, Slack); CRUD sync complexity vs append-only mail |
| [brain-cloud-service.md](./brain-cloud-service.md) | Pre-opportunity notes: what a Brain-operated cloud service would contain (registry, support infra, tunnel relay) and the hard constraint that no user data ever leaves the local brain. **Brain-to-brain strategy:** [OPP-042](../opportunities/OPP-042-brain-network-interbrain-trust-epic.md) |

**Ripmail** (Rust CLI + index): [`../../ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md).

*Recorded considerations* are decisions or research notes that are **not** feature opportunities—they document why we chose a path or deferred an alternative, for future readers.
