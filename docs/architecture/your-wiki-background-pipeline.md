# Your Wiki background pipeline

**Canonical architecture** for automated wiki building after onboarding: the **Your Wiki supervisor** runs continuous **survey → validate → execute → cleanup** laps. There is **no** separate wiki bootstrap phase—**vault scaffold + first survey** starts as soon as the supervisor runs.

**Related:**

- **[background-task-orchestration.md](./background-task-orchestration.md)** — `GET /api/background-status`, wiki kick, troubleshooting
- **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)** — mail refresh, one loop per process
- **[onboarding-state-machine.md](./onboarding-state-machine.md)** — when the wiki kick runs
- **Product:** [OPP-033](../opportunities/OPP-033-wiki-compounding-karpathy-alignment.md)

---

## TL;DR

| Step | Agent / role | New pages? | Notes |
|------|----------------|------------|--------|
| **Survey** | `wiki-survey` (readonly) | No | Ends with a fenced **`WikiLapPlan` JSON** block (`idle`, `reasoning`, `newPages`, `deepens`, `refreshes`, `skipped`). Tool budget: `WIKI_SURVEY_MAX_TOOL_CALLS` ([`wikiLap.ts`](../../src/shared/wikiLap.ts)). Prompts stress **importance over raw recency** ([`wiki-survey/system.hbs`](../../src/server/prompts/wiki-survey/system.hbs)). |
| **Validate** | Server (`wikiLapPlan`) | — | Parses model text; **`validateAndSanitizeWikiLapPlan`** drops work items without resolvable mail evidence, enforces `WIKI_LAP_PLAN_CAP`, may force **`idle`** if nothing actionable remains. |
| **Execute** | `wiki-execute` | **New .md files:** only paths listed under **`plan.newPages`** (and only under allowed prefixes: `people/`, `projects/`, `topics/`, etc.). **Existing files:** **`deepens`** / **`refreshes`** target edits only—writes to those paths are always allowed when the file already exists. | `wikiWriteCreates: planAllowlist` in [`wikiScopedFsTools.ts`](../../src/server/agent/tools/wikiScopedFsTools.ts). Tool budget: `WIKI_EXECUTE_MAX_TOOL_CALLS`. |
| **Cleanup** | `wiki-cleanup` | No (`edit` only) | Delta-anchored on execute `changedFiles` when non-empty; otherwise vault-wide. Receives **`plan.newPages` paths** so **`index.md`** can gain `[[wikilinks]]` to new entity pages. |

**One lap** (see [`runWikiYourLap`](../../src/server/agent/wikiExpansionRunner.ts)):

1. **Lap 1:** survey → validate → (optional) execute → cleanup. **No** blocking mail refresh before survey.
2. **Lap 2+:** **Mail/calendar sync** first (up to **90s** via `refreshMailAndWait`), with `syncNote` to agents on success/failure, then the same pipeline.
3. After execute+cleanup, **meaningful progress** = paths whose on-disk bytes changed by at least **`WIKI_LAP_MIN_MEANINGFUL_CHARS`** vs a **pre-execute byte snapshot** of plan targets plus `index.md` (see `runWikiYourLap` in [`wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts)).
4. **Saturation ledger** is merged from that outcome (meaningful paths, deltas, evidence IDs); **consecutive laps** with **`meaningfulPaths.length === 0`** increment the no-op counter → backoff / idle ([`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts)).

---

## Preflight (before the supervisor starts)

Your Wiki auto-start uses **`wikiSupervisorMailPreflightPasses`** ([`wikiMailIndexedHistoryGate.ts`](../../src/shared/wikiMailIndexedHistoryGate.ts)):

1. Mail **configured** (`config.json` present).
2. Indexed message count ≥ **`WIKI_BUILDOUT_MIN_MESSAGES`** (1000) — see [`onboardingProfileThresholds.ts`](../../src/shared/onboardingProfileThresholds.ts).
3. **Indexed history depth:** oldest message date in ripmail **`dateRange.from`** must be at least **`WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS`** (90 calendar days rolling window) before “now,” so survey is not dominated by a thin recent slice.

[`kickWikiSupervisorIfIndexedGatePasses`](../../src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts) runs from **`GET /api/onboarding/mail`**, **`GET /api/background-status`**, and interview finalize. When the count gate passes but **history depth** does not, it logs **`[wiki/indexed-gate] waiting for deeper indexed mail history`** and applies an in-process **cooldown** (default **3 minutes**) before calling `getOnboardingMailStatus` again—Hub polls do not busy-loop the gate.

---

## Inter-lap timing (supervisor loop)

After each lap, [`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts) waits before **`lap++`** and the next pre-lap sync (lap 2+):

| Situation | Wait before next lap |
|-----------|---------------------|
| **Meaningful** lap (`meaningfulPaths.length > 0`) and **mail sync succeeded** (`lapMailSyncIncomplete` false) | **`INTER_LAP_DELAY_MS`** (5s) |
| **Meaningful** lap but **pre-lap mail refresh failed or timed out** (`lapMailSyncIncomplete` true) | **`INTER_LAP_DELAY_AFTER_MAIL_SYNC_GAP_MS`** (same as first no-op step: **2 minutes**) — gives index/backfill time to catch up |
| **No-op** lap (no meaningful path deltas) | Escalating **`NO_OP_BACKOFF_MS`**: **2m → 10m → 30m** |
| **3** consecutive no-ops | **Idle** UI; wait up to **30m** or wake early (`requestLapNow`, mail sync completion, etc.) |

No-op streak behavior is unchanged: the long post-sync delay applies only when the lap was “productive” but mail sync was incomplete.

---

## Hub / API vs pipeline

`GET /api/background-status` maps internal pipeline steps to stable **phase** strings ([`YourWikiPhase`](../../src/server/lib/chat/backgroundAgentStore.ts)):

| API `phase` | Pipeline moment |
|-------------|----------------|
| `surveying` | Survey agent; lap 2+ may show “syncing first…” |
| `enriching` | **Execute** (`wiki-execute`)—legacy label retained for UI |
| `cleaning` | Cleanup agent |
| `idle` / `paused` / `error` | As today |

**Mail slice** ([`backgroundStatus.ts`](../../src/shared/backgroundStatus.ts)):

- **`indexedHistoryDepthOk`** — `mailIndexMeetsWikiSupervisorHistoryMinimum` (90d depth).
- **`wiki.autoStartEligible`** — same predicate as preflight (`wikiSupervisorMailPreflightPasses`). Not tied to onboarding `done`.
- **`onboarding.milestones.wikiReady`** — onboarding **`done`** **and** `wikiSupervisorMailPreflightPasses` (count + configured + depth). **No** legacy bootstrap milestone.

---

## Pause, resume, and shutdown

- **Pause** aborts in-flight work and clears survey/execute sessions (`pauseWikiExpansionRun`); cleanup session is paused separately where applicable.
- **Resume** starts the supervisor loop again; **each new lap always begins with survey** (full survey → execute → cleanup). Nothing resumes “mid-tool” from a prior session.
- **Shutdown** (`prepareWikiSupervisorShutdown`) aborts sync/agents without persisting user pause.

---

## Idle / no-op

- After validation: **`plan.idle`** or **zero** retained **`newPages` / `deepens` / `refreshes`** → **execute and cleanup are skipped** (survey-only lap); the last-lap plan file is still updated with an **`idle`** outcome.
- After a full execute+cleanup lap: **no-op** when **`meaningfulPaths`** is empty—**not** when raw tool or edit counts are zero.

---

## Modules

| Piece | Location |
|-------|----------|
| Supervisor loop | [`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts) |
| Lap runner | [`wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts) — `runWikiYourLap`, `onLapPhase` hooks |
| Wiki kick + history throttle | [`wikiKickAfterOnboardingDone.ts`](../../src/server/lib/backgroundTasks/wikiKickAfterOnboardingDone.ts) |
| Preflight / depth helpers | [`wikiMailIndexedHistoryGate.ts`](../../src/shared/wikiMailIndexedHistoryGate.ts), thresholds in [`onboardingProfileThresholds.ts`](../../src/shared/onboardingProfileThresholds.ts) |
| Survey agent | [`wikiSurveyAgent.ts`](../../src/server/agent/wikiSurveyAgent.ts), [`wiki-survey/system.hbs`](../../src/server/prompts/wiki-survey/system.hbs) |
| Execute agent | [`wikiExecuteAgent.ts`](../../src/server/agent/wikiExecuteAgent.ts), [`wiki-execute/system.hbs`](../../src/server/prompts/wiki-execute/system.hbs) |
| **`wikiBuildoutAgent`** | [`wikiBuildoutAgent.ts`](../../src/server/agent/wikiBuildoutAgent.ts) — thin compatibility re-export for evals and older imports (**same runtime as execute**) |
| Plan schema / validation | [`wikiLapPlan.ts`](../../src/server/lib/wiki/wikiLapPlan.ts) |
| Plan persistence | [`wikiLapPlanPersistence.ts`](../../src/server/lib/wiki/wikiLapPlanPersistence.ts) |
| Saturation ledger | [`wikiSaturationLedger.ts`](../../src/server/lib/wiki/wikiSaturationLedger.ts) (`var/wiki-saturation.json`) |
| Vault vs index gaps (injected into survey) | [`wikiVaultIndexGap.ts`](../../src/server/lib/wiki/wikiVaultIndexGap.ts) |
| Write allowlist for new files | [`wikiScopedFsTools.ts`](../../src/server/agent/tools/wikiScopedFsTools.ts) (`planAllowlist` / `writeAllowlistRelPaths`) |
| Hub payload | [`buildBackgroundStatus.ts`](../../src/server/lib/backgroundTasks/buildBackgroundStatus.ts) |
| Lap constants | [`wikiLap.ts`](../../src/shared/wikiLap.ts) |

Smoke JSONL evals for survey/execute/cleanup: [`eval/tasks/wiki-v1.jsonl`](../../eval/tasks/wiki-v1.jsonl).

---

## Persistence (summary)

| Artifact | Role |
|----------|------|
| `background/runs/your-wiki.json` | Supervisor doc: `phase`, `lap`, timeline, usage, `lapMailSyncIncomplete` |
| `$BRAIN_HOME/your-wiki/state.json` | Pause flag |
| `var/wiki-saturation.json` | Per-path saturation hints for survey |
| `var/wiki-last-lap-plan.json` | Last plan + outcomes — [`wikiLapPlanPersistence.ts`](../../src/server/lib/wiki/wikiLapPlanPersistence.ts) |
| `var/wiki-edits.jsonl` | Recent edits — context for survey / cleanup |

*Last reviewed against: `yourWikiSupervisor.ts`, `wikiExpansionRunner.ts`, `wikiLapPlan.ts`, `wikiKickAfterOnboardingDone.ts`, `wikiMailIndexedHistoryGate.ts`, `buildBackgroundStatus.ts`.*
