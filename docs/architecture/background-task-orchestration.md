# Background task orchestration

Holistic view for **mail indexing**, **onboarding milestones**, and **background status HTTP** — ships the framing in [OPP-094 (archived)](../opportunities/archive/OPP-094-holistic-onboarding-background-task-orchestration.md).

**Your Wiki pipeline (bootstrap, laps, agents, limits):** **[your-wiki-background-pipeline.md](./your-wiki-background-pipeline.md)** — canonical detail.

**Process model / scaling:** mail refresh triggers, **one supervisor loop per Node process**, multi-tenant caveats — **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)**.

## HTTP

| Route | Role |
|-------|------|
| **`GET /api/background-status`** | Single JSON snapshot: `mail`, `wiki` (includes **`wiki.bootstrap`** state), `onboarding.milestones`, optional `orchestrator.recentFailures`. Hub polls this (see `BrainHubPage.svelte`). Also **`void`**‑kicks wiki supervisor when indexed gate passes. |
| `GET /api/inbox/mail-sync-status` | Raw ripmail status slice only — retained for older callers; Hub should prefer **`/api/background-status`**. |
| `GET /api/events` | SSE push for `your_wiki` / `background_agents` — Hub opens this connection on mount for live wiki doc updates. |
| **`GET/POST /api/your-wiki`** | Your Wiki doc, pause, resume, run-lap — see [your-wiki-background-pipeline.md](./your-wiki-background-pipeline.md#http-api-your-wiki) |

## Server modules

| Area | Path |
|------|------|
| Unified payload builder | [`src/server/lib/backgroundTasks/buildBackgroundStatus.ts`](../../src/server/lib/backgroundTasks/buildBackgroundStatus.ts) |
| JSON shape (client + server) | [`src/shared/backgroundStatus.ts`](../../src/shared/backgroundStatus.ts) |
| Wiki kick at indexed threshold (`WIKI_BUILDOUT_MIN_MESSAGES`) **→ bootstrap then supervisor** | [`src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts`](../../src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts) |
| Your Wiki supervisor | [`src/server/agent/yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts) |
| Enrich + cleanup invocations | [`src/server/agent/wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts) |
| Bootstrap runner | [`src/server/agent/wikiBootstrapRunner.ts`](../../src/server/agent/wikiBootstrapRunner.ts), [`wikiBootstrapAgent.ts`](../../src/server/agent/wikiBootstrapAgent.ts) |
| Bootstrap budgets | [`src/shared/wikiBootstrap.ts`](../../src/shared/wikiBootstrap.ts) |
| Orchestrator hooks + failure log | [`src/server/lib/backgroundTasks/orchestrator.ts`](../../src/server/lib/backgroundTasks/orchestrator.ts) |
| Persisted failure queue (FIFO cap) | [`src/server/lib/backgroundTasks/taskQueue.ts`](../../src/server/lib/backgroundTasks/taskQueue.ts) |

## Wiki kick order (summary)

1. **Indexed gate:** mail **configured**, indexed ≥ **`WIKI_BUILDOUT_MIN_MESSAGES`** (**1000**).
2. **Bootstrap:** one-shot agent unless **`WIKI_BOOTSTRAP_SKIP`** or already completed — supervisor **deferred** while **`running`**.
3. **Supervisor:** `ensureYourWikiRunning()` — steady-state **enrich → cleanup** laps.

Full lap algorithm, agent prompts, injection limits, and APIs: **[your-wiki-background-pipeline.md](./your-wiki-background-pipeline.md)**.

## Reliability behaviors

- **Wiki lap mail refresh:** `refreshMailAndWait` timeouts return **`ok: false`** (not a silent success). The supervisor still runs the lap but sets **`lapMailSyncIncomplete`** on the `your-wiki` background doc and injects a cautious `syncNote` for the enrich agent.
- **Supervisor outer-loop crash:** Errors are persisted via **`recordWikiSupervisorOuterLoopFailure`** (orchestrator queue) and the loop schedules a **bounded auto-restart** (backoff, max 3 attempts per streak). Successful laps reset the crash streak.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Wiki never starts despite enough mail | Mail **`configured`**, indexed ≥ **`WIKI_BUILDOUT_MIN_MESSAGES`** (1000), supervisor **not paused**. If **`wiki.bootstrap.status`** stuck **`running`**, operator may clear **`chats/onboarding/wiki-bootstrap.json`** /see **`clearOnboardingStaging`**. Kick runs from **`GET /api/onboarding/mail`** / **`GET /api/background-status`** — logs **`[wiki/indexed-gate]`** / **`[wiki/bootstrap-gate]`**. |
| Hub wiki status stale until Assistant opens | Ensure **`startHubEventsConnection()`** runs on Hub (opens `/api/events`). |
| “Stale mail context” on wiki row | Last pre-lap **`ripmail refresh`** timed out or failed — safe to run **Sync mail now** from Hub or retry a lap. |
| Pause/resume wrong run | Hub must call **`/api/your-wiki/*`** for **`your-wiki`**, not legacy **`wiki-expansion`** UUID runs — [BUG-018](../bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md). |

See also: **[onboarding-state-machine.md](./onboarding-state-machine.md)** (phased mail + state gates) · **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)** (mail triggers, single supervisor loop, multi-tenant).
