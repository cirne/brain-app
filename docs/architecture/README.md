# Architecture — detailed docs

Brain-app overview and index: **[../ARCHITECTURE.md](../ARCHITECTURE.md)**.

| Document | Topic |
|----------|--------|
| [../google-oauth.md](../google-oauth.md) | Gmail OAuth redirect URIs (dev `:3000` vs bundled `:18473`), Google Console registration |
| [runtime-and-routes.md](./runtime-and-routes.md) | Hono + Vite, `/api/*` map, auth, bundled listen address + Tailscale allowlist, periodic sync |
| [agent-chat.md](./agent-chat.md) | pi-agent-core, chat persistence, SSE events, tools overview |
| [data-and-sync.md](./data-and-sync.md) | `$BRAIN_HOME` layout, wiki, calendar cache, ripmail refresh |
| [integrations.md](./integrations.md) | Ripmail subprocess, `/api/search`, `/api/files`, optional iMessage; **trust boundaries** (ripmail vs `chat.db`) |
| [configuration.md](./configuration.md) | Environment variables |
| [future-durability.md](./future-durability.md) | Possible future SQLite for app-owned state |
| [wiki-read-vs-read-doc.md](./wiki-read-vs-read-doc.md) | ADR: wiki file tools vs `read_doc` |
| [wiki-vs-managed-memory-honcho.md](./wiki-vs-managed-memory-honcho.md) | Recorded consideration: wiki-first memory vs Honcho (or similar); **not for now** |

**Ripmail** (Rust CLI + index): [`../../ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md).

*Recorded considerations* are decisions or research notes that are **not** feature opportunities—they document why we chose a path or deferred an alternative, for future readers.
