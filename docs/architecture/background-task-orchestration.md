# Background task orchestration

Holistic view for **mail indexing**, **onboarding milestones**, **wiki first-draft bootstrap** ([OPP-095](../opportunities/OPP-095-wiki-first-draft-bootstrap.md)), and **Your Wiki** supervisor — implemented for [OPP-094](../opportunities/OPP-094-holistic-onboarding-background-task-orchestration.md).

## HTTP

| Route | Role |
|-------|------|
| **`GET /api/background-status`** | Single JSON snapshot: `mail`, `wiki` (includes **`wiki.bootstrap`** state), `onboarding.milestones`, optional `orchestrator.recentFailures`. Hub polls this (see `BrainHubPage.svelte`). |
| `GET /api/inbox/mail-sync-status` | Raw ripmail status slice only — retained for older callers; Hub should prefer **`/api/background-status`**. |
| `GET /api/events` | SSE push for `your_wiki` / `background_agents` — Hub opens this connection on mount for live wiki doc updates. |

## Server modules

| Area | Path |
|------|------|
| Unified payload builder | [`src/server/lib/backgroundTasks/buildBackgroundStatus.ts`](../../src/server/lib/backgroundTasks/buildBackgroundStatus.ts) |
| JSON shape (client + server) | [`src/shared/backgroundStatus.ts`](../../src/shared/backgroundStatus.ts) |
| Wiki kick at indexed threshold (`WIKI_BUILDOUT_MIN_MESSAGES`) **→ bootstrap then supervisor** | [`src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts`](../../src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts) |
| Bootstrap runner (single agent invocation) | [`src/server/agent/wikiBootstrapRunner.ts`](../../src/server/agent/wikiBootstrapRunner.ts), [`src/server/agent/wikiBootstrapAgent.ts`](../../src/server/agent/wikiBootstrapAgent.ts) |
| Bootstrap budgets (shared constants) | [`src/shared/wikiBootstrap.ts`](../../src/shared/wikiBootstrap.ts) |
| Orchestrator hooks + failure log | [`src/server/lib/backgroundTasks/orchestrator.ts`](../../src/server/lib/backgroundTasks/orchestrator.ts) |
| Persisted failure queue (FIFO cap) | [`src/server/lib/backgroundTasks/taskQueue.ts`](../../src/server/lib/backgroundTasks/taskQueue.ts) |

## Wiki bootstrap vs maintenance

1. **Indexed gate:** same **`WIKI_BUILDOUT_MIN_MESSAGES`** threshold as before.
2. **Bootstrap:** If **`wiki-bootstrap.json`** is **`not-started`**, **`enqueueWikiBootstrap`** runs once (serialized chain). While **`running`**, the supervisor **does not** start.
3. **Supervisor:** After bootstrap **`completed`** or **`failed`** (degraded), **`ensureYourWikiRunning`** runs — steady-state laps remain **edit-first** per archived OPP-067.
4. **Skip env:** **`WIKI_BOOTSTRAP_SKIP=true`** persists a **`skipped`** completion and skips the bootstrap agent (operators).

## Reliability behaviors

- **Wiki lap mail refresh:** `refreshMailAndWait` timeouts return **`ok: false`** (not a silent success). The supervisor still runs the lap but sets **`lapMailSyncIncomplete`** on the `your-wiki` background doc and injects a cautious `syncNote` for the enrich agent.
- **Supervisor outer-loop crash:** Errors are persisted via **`recordWikiSupervisorOuterLoopFailure`** (orchestrator queue) and the loop schedules a **bounded auto-restart** (backoff, max 3 attempts per streak). Successful laps reset the crash streak.
- **Dead code removed:** `ripmailBackfillSupervisor` was unused in production and deleted.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Wiki never starts despite enough mail | Mail **`configured`**, indexed ≥ **`WIKI_BUILDOUT_MIN_MESSAGES`** (1000), supervisor **not paused**. If **`wiki.bootstrap.status`** stuck **`running`**, operator may clear **`chats/onboarding/wiki-bootstrap.json`** /see **`clearOnboardingStaging`**. Kick runs from **`GET /api/onboarding/mail`** / **`GET /api/background-status`** — logs **`[wiki/indexed-gate]`** / **`[wiki/bootstrap-gate]`**. |
| Hub wiki status stale until Assistant opens | Ensure **`startHubEventsConnection()`** runs on Hub (opens `/api/events`). |
| “Stale mail context” on wiki row | Last pre-lap **`ripmail refresh`** timed out or failed — safe to run **Sync mail now** from Hub or retry a lap. |

See also: **[onboarding-state-machine.md](./onboarding-state-machine.md)** (phased mail + state gates).
