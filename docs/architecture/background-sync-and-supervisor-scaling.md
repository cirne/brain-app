# Background mail sync and Your Wiki supervisor — process model & scaling

How **incremental mail index refresh** and the **Your Wiki** supervisor relate to HTTP requests, browser presence, and **multi-tenant** deployments. Complements **[background-task-orchestration.md](./background-task-orchestration.md)** (routes, orchestrator, bootstrap) and **[data-and-sync.md](./data-and-sync.md)** (storage layout).

---

## TL;DR

- There is **no** process-wide timer that runs `runFullSync()` every *N* seconds for all tenants. **`SYNC_INTERVAL_SECONDS` / `getSyncIntervalMs()`** exist in [`syncAll.ts`](../../src/server/lib/platform/syncAll.ts) but are **not** wired to a server `setInterval` today.
- **Mail refresh** runs when something **explicitly** triggers it: API routes, agent tools, the **Your Wiki** lap preamble, onboarding flows, or the **`sync-cli`** helper — not because “the user has a tab open.” Implementation is **`ripmailRefresh`** from **`@server/ripmail/sync`** (TypeScript, in-process), not a `ripmail refresh` subprocess.
- **Hub** polling of **`GET /api/background-status`** is **per browser** and updates **status UI**; it does not, by itself, run a mail refresh (though that route **does** call the wiki indexed-gate kick — see below).
- **Your Wiki** uses **at most one in-process supervisor loop** per Node OS process (`loopRunning` in [`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts)). That loop binds **one tenant** via `AsyncLocalStorage.run` for its lifetime. **Many tenants on one process do not get N parallel supervisor loops.**

---

## What triggers mail refresh

| Trigger | Tenant / scope | Notes |
|--------|----------------|--------|
| `POST /api/inbox/sync` | Current session → ripmail home | Fire-and-forget from handler; see [`inbox.ts`](../../src/server/routes/inbox.ts). Onboarding may run **`syncInboxRipmailOnboarding`** (`refresh` + **`historicalSince: '1y'`**) instead of a plain `refresh`. |
| `POST /api/calendar/sync` | Same | Full refresh (mail + indexed calendar); [`calendar.ts`](../../src/server/routes/calendar.ts). |
| `POST /api/calendar/refresh` | Same | Calendar sources only. |
| Your Wiki supervisor — laps after the first | Tenant bound when the loop started | **`refreshMailAndWait`** before enrich; ~90s cap; [`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts). Lap 1 skips refresh (build-out after onboarding). |
| Agent tools (e.g. `refresh_sources`) | Request tenant | Same in-process **`@server/ripmail`** stack as other mail routes. |
| `npm run …` / **`sync-cli`** | Process default tenant / `BRAIN_HOME` resolution | Calls **`runFullSync()`** ([`sync-cli.ts`](../../src/server/sync-cli.ts)). |

Implementation detail: handlers await **`ripmailRefresh`** via **`syncInboxRipmail`** / **`refreshMailAndWait`** in [`syncAll.ts`](../../src/server/lib/platform/syncAll.ts) (in-process TypeScript).

---

## Hub polling vs mail work

- **`BrainHubPage`** polls **`GET /api/background-status`** on an interval when the document is **visible** (`visibilityState !== 'hidden'`). That refetches **JSON status** for the UI.
- **`GET /api/background-status`** also **`void`**‑calls **`kickWikiSupervisorIfIndexedGatePasses()`** ([`backgroundStatus.ts`](../../src/server/routes/backgroundStatus.ts)), which may start **`ensureYourWikiRunning()`** when the indexed gate passes. That is **not** a shared global heartbeat: each **signed-in** user’s browser drives **their own** poll cadence when the Hub is open.

---

## Your Wiki supervisor: timing and mail

Design intent is documented in the module header of **`yourWikiSupervisor.ts`**: **one in-process loop, no cron.**

- Between laps: **`INTER_LAP_DELAY_MS`** (5s) when the last lap produced work, else **no-op backoff** steps (**2m → 10m → 30m**). After sustained no-ops, the loop can sit in **idle** until a **timeout** or a **wake** (`requestLapNow`, resume, etc.).
- **Mail**: every lap **after the first** awaits **`refreshMailAndWait`** so the enrich agent sees a fresher index when refresh succeeds.

Failure handling and **`lapMailSyncIncomplete`** are covered in **[background-task-orchestration.md](./background-task-orchestration.md)**.

---

## Multi-tenant and scaling (one Node process)

### Single supervisor slot per process

[`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts) keeps a **module-level** `loopRunning`. **`kickSupervisorLoop`** returns early if a loop is already running. So **two tenants cannot each run a supervisor lap concurrently** in the same Node process.

When a loop **starts**, the **tenant** is captured (`tryGetTenantContext()` at **`ensureYourWikiRunning`** entry) and the async work runs under **`getTenantContextStore().run(tenantForLoop, () => supervisorLoop(...))`** so **`brainHome()`**, wiki paths, and ripmail home resolve for **that** workspace.

### Global `isPaused` vs per-tenant disk

**`isPaused`** is also **module-level**. **`ensureYourWikiRunning`** reloads it from **the current request’s** persisted state (`loadPersistedState()` uses **`brainHome()`** for that request). In **hosted multi-tenant**, interleaved requests from **different** users can **overwrite the same in-memory `isPaused`** with **their** tenant’s `state.json` value — coupling tenants at the process level. **Persisted** pause files remain per-tenant on disk; the hazard is **in-memory** coherence when many workspaces share one long-lived server.

**Startup diagnostics** note that **`BRAIN_HOME` is per-request** in hosted mode and that there is **no** process-level periodic wiki/sync cron ([`startupDiagnostics.ts`](../../src/server/lib/platform/startupDiagnostics.ts)): background work is driven by **requests** and the **single** supervisor loop when it is active.

### Mail refresh concurrency

Per-tenant **`POST /api/inbox/sync`** is naturally **scoped to the session** that issued it. Overlapping **`ripmailRefresh`** calls share one Node process and one tenant SQLite + IMAP stack — there is **no** separate `ripmailHeavySpawn` subprocess serializer anymore. Heavy deployments still need to budget **CPU, IMAP connections, and LLM** for wiki laps separately from “many users clicked sync.”

### Directions for horizontal scale

For **many tenants** on shared infrastructure:

- **Isolate** wiki supervisor + LLM work (dedicated workers, **one tenant per container** patterns — see **[multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)** / **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)**), **or**
- Accept **serialized** wiki background work inside a single Node process and treat global supervisor flags as a **known contention point** until refactored to **per-tenant schedulers** or an external queue.

Related: in-memory **agent session Map** limits for multi-instance chat — **[agent-session-store.md](./agent-session-store.md)**.

---

## Shutdown

**`registerPeriodicSyncAndShutdown`** ([`periodicSyncAndShutdown.ts`](../../src/server/lifecycle/periodicSyncAndShutdown.ts)) handles **SIGINT/SIGTERM**: stops tunnel, prepares wiki supervisor shutdown, terminates any **tracked ripmail child processes** (rare subprocess adapters), closes the HTTP server — **not** a periodic sync ticker. (The name reflects “lifecycle hooks” bundled in one registration.)

**`prepareWikiSupervisorShutdown`** aborts in-flight lap refresh and agent phases cleanly.

---

## Related documentation

| Doc | Relevance |
|-----|------------|
| **[background-task-orchestration.md](./background-task-orchestration.md)** | **`/api/background-status`**, bootstrap vs supervisor, orchestrator queue, lap mail failures |
| **[runtime-and-routes.md](./runtime-and-routes.md)** | Server listen, route map, auth; **background sync** section defers here (no global `runFullSync` timer) |
| **[onboarding-state-machine.md](./onboarding-state-machine.md)** | Phased mail, **`GET /api/onboarding/mail`** poll, refresh vs backfill |
| **[data-and-sync.md](./data-and-sync.md)** | `$BRAIN_HOME`, ripmail layout, **`runFullSync`** semantics |
| [ripmail-rust-snapshot.md](./ripmail-rust-snapshot.md) | Rust-era **`refresh`** vs **`backfill`** lanes (`ripmail/docs/SYNC.md` on tag) |
| **[multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)** | Cells, locks, one-tenant-per-container direction |
| **[deployment-models.md](./deployment-models.md)** | Desktop vs cloud |
| [OPP-094 (archived)](../opportunities/archive/OPP-094-holistic-onboarding-background-task-orchestration.md) | Product framing for unified background status |

---

*Last reviewed against server sources: `yourWikiSupervisor.ts`, `syncAll.ts`, `backgroundStatus.ts`, `periodicSyncAndShutdown.ts`, `startupDiagnostics.ts`.*
