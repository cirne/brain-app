# Background task orchestration

Holistic view for **mail indexing**, **onboarding milestones**, and **background status HTTP** — ships the framing in [OPP-094 (archived)](../opportunities/archive/OPP-094-holistic-onboarding-background-task-orchestration.md).

**Your Wiki pipeline (survey/execute/cleanup laps):** **[your-wiki-background-pipeline.md](./your-wiki-background-pipeline.md)** — canonical detail.

**Process model / scaling:** mail refresh triggers, **one supervisor loop per Node process**, multi-tenant caveats — **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)**.

## HTTP

| Route | Role |
|-------|------|
| **`GET /api/background-status`** | Single JSON snapshot: `mail`, `wiki`, `onboarding.milestones`, optional `orchestrator.recentFailures`. Hub polls this (see `BrainHubPage.svelte`). Also **`void`**‑kicks wiki supervisor when **wiki preflight** passes (indexed count + mail configured + indexed history depth). |
| `GET /api/inbox/mail-sync-status` | Raw ripmail status slice only — retained for older callers; Hub should prefer **`/api/background-status`**. |
| `GET /api/events` | SSE push for `your_wiki` / `background_agents` — Hub opens this connection on mount for live wiki doc updates. |
| **`GET/POST /api/your-wiki`** | Your Wiki doc, pause, resume, run-lap — see server routes and [your-wiki-background-pipeline.md](./your-wiki-background-pipeline.md). |

## Server modules

| Area | Path |
|------|------|
| Unified payload builder | [`src/server/lib/backgroundTasks/buildBackgroundStatus.ts`](../../src/server/lib/backgroundTasks/buildBackgroundStatus.ts) |
| JSON shape (client + server) | [`src/shared/backgroundStatus.ts`](../../src/shared/backgroundStatus.ts) |
| Wiki kick when preflight passes **→ supervisor** | [`src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts`](../../src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts) |
| Your Wiki supervisor | [`src/server/agent/yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts) |
| Survey + execute + cleanup invocations | [`src/server/agent/wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts) |
| Orchestrator hooks + failure log | [`src/server/lib/backgroundTasks/orchestrator.ts`](../../src/server/lib/backgroundTasks/orchestrator.ts) |
| Persisted failure queue (FIFO cap) | [`src/server/lib/backgroundTasks/taskQueue.ts`](../../src/server/lib/backgroundTasks/taskQueue.ts) |

## Wiki kick order (summary)

1. **Preflight** ([`wikiSupervisorMailPreflightPasses`](../../src/shared/wikiMailIndexedHistoryGate.ts)): mail **configured**, indexed ≥ **`WIKI_BUILDOUT_MIN_MESSAGES`** (1000), oldest indexed message ≥ **`WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS`** (90) before now.
2. **Throttle:** if count passes but depth does not, the kick uses an in-process **cooldown** (~3 min) before re-querying mail status (Hub polls do not tight-loop).
3. **Supervisor:** `ensureYourWikiRunning()` — steady-state **survey → execute → cleanup** laps.

Full lap algorithm, inter-lap delays, agent prompts, and APIs: **[your-wiki-background-pipeline.md](./your-wiki-background-pipeline.md)**.

## Reliability behaviors

- **Wiki lap mail refresh:** `refreshMailAndWait` timeouts return **`ok: false`** (not a silent success). The supervisor still runs the lap but sets **`lapMailSyncIncomplete`** on the `your-wiki` background doc and injects a cautious `syncNote` for the survey/execute agents. After a **meaningful** lap with that flag set, the next inter-lap wait is **2 minutes** (not 5s) so the index can catch up — see **[your-wiki-background-pipeline.md § Inter-lap timing](./your-wiki-background-pipeline.md#inter-lap-timing-supervisor-loop)**.
- **Supervisor outer-loop crash:** Errors are persisted via **`recordWikiSupervisorOuterLoopFailure`** (orchestrator queue) and the loop schedules a **bounded auto-restart** (backoff, max 3 attempts per streak). Successful laps reset the crash streak.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Wiki never starts despite “enough” messages | Preflight needs **1000+** messages **and** **90 days** of indexed history (`mail.indexedHistoryDepthOk` on **`GET /api/background-status`**). Kick runs from **`GET /api/onboarding/mail`** / **`GET /api/background-status`** — logs **`[wiki/indexed-gate]`** (including **waiting for deeper indexed mail history**). Supervisor **not paused**. |
| Hub wiki status stale until Assistant opens | Ensure **`startHubEventsConnection()`** runs on Hub (opens `/api/events`). |
| “Stale mail context” on wiki row | Last pre-lap **`ripmail refresh`** timed out or failed — safe to run **Sync mail now** from Hub or retry a lap. |
| Pause/resume wrong run | Hub must call **`/api/your-wiki/*`** for **`your-wiki`**, not legacy **`wiki-expansion`** UUID runs — [BUG-018](../bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md). |

See also: **[onboarding-state-machine.md](./onboarding-state-machine.md)** (phased mail + state gates) · **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)** (mail triggers, single supervisor loop, multi-tenant).
