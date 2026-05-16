# OPP-033: Wiki compounding loop and Karpathy alignment

> **Implementation architecture (canonical):** [your-wiki-background-pipeline.md](../architecture/your-wiki-background-pipeline.md) — bootstrap, supervisor laps, enrich/cleanup agents, limits, APIs. This OPP remains the **product / vision** umbrella; avoid duplicating lap-level detail here.

## Why this exists

Several threads converge on the same risk: **ripmail is rich ground truth**, but the **wiki’s reason to exist** is **amortized synthesis** (cross-links, stable entity pages, explicit contradictions, compounding over time)—not a second copy of mail. Andrej Karpathy’s **[LLM Wiki](../karpathy-llm-wiki-post.md)** pattern ([gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)) stresses **ingest → query → lint**, a **persistent compounding artifact**, and **bookkeeping at scale** (many files per pass). Brain’s [VISION.md](../VISION.md) cites that inspiration; [the-wiki-question.md](../the-wiki-question.md) poses open questions about **when** the wiki pays off vs **re-querying mail**.

This opportunity is the **product/engineering umbrella** for closing the gap: **make the wiki earn its keep** without opening ten separate initiatives.

## How existing agents fit (expansion vs maintenance)


| Agent / flow (shipped) | Karpathy-ish role | When it runs |
| ---------------------- | ----------------- | ------------ |
| **Wiki bootstrap** ([`wikiBootstrapRunner`](../../src/server/agent/wikiBootstrapRunner.ts)) | **Bounded first ingest** — `write` stubs for people/projects/topics/travel | Once after indexed gate; before supervisor ([pipeline doc](../architecture/your-wiki-background-pipeline.md)) |
| **Your Wiki enrich** ([`runEnrichInvocation`](../../src/server/agent/wikiExpansionRunner.ts) + buildout agent) | **Deepen** existing pages from mail + queue | Every supervisor lap |
| **Your Wiki cleanup** ([`runCleanupInvocation`](../../src/server/agent/wikiExpansionRunner.ts)) | **Lint** — links, orphans, index | End of each supervisor lap |
| **Legacy `wiki-expansion` runs** | Same enrich agent, UUID run id | Hub / API one-off; **not** the continuous loop |
| **Main chat assistant** | **Query** + optional wiki **write** for new pages | Every session |

**Chat** creates new pages; **bootstrap** seeds the vault once; **supervisor** deepens and lints in laps. [OPP-027](./archive/OPP-027-wiki-nav-indicator-and-activity-surface.md) surfaces activity in Hub.

## Ingest cadence: Brain vs Karpathy (important distinction)

Karpathy’s gist often reads as **ingest each new source** into the wiki soon after it lands, sometimes **one file at a time** with the human watching—reasonable when “sources” are articles, PDFs, or clipped pages at **human scale**.

Brain’s **source** is mostly **email (and more) at mailbox scale**. Re-running a full wiki **ingestion** agent on **every new message** would be **noise-heavy**, expensive, and would fight users who already have **fast indexed search** (`search_index`, `read_mail_message`, `read_indexed_file`) for raw evidence. The intended shape is:

- **Continuous / automatic:** **ripmail (and friends) keep the corpus indexed** — this is the always-on layer, not an LLM loop per mail.
- **One setup + periodic / batch wiki updates:** **expansion** after profile accept or on demand; **maintenance** on a schedule or **coarse** triggers (sync finished, weekly lint, Hub “run now”); optional **larger** passes when the user asks or approves ([OPP-026](./archive/OPP-026-knowledge-expansion-discovery-ui.md)).

So the analogy is **not** “LLM ingest ≡ every new email.” It is: **index stays fresh automatically; the wiki is updated in deliberate batches** so synthesis **compounds** without becoming a spam cannon. OPP-033’s “ingest” language means **wiki ingest**, **not** re-indexing mail. Success criteria below use **query / file-back / lint** where **lint + periodic expansion** replace Karpathy’s **per-source ingest** at mail cadence.

## Unified wiki pipeline (continuous loop — preferred UX simplification)

Instead of exposing **separate** “expansion” vs “maintenance cron” mental models, the product can offer **one long-running wiki process** while Brain is active (or user-requested):

1. **Build-out** — close gaps vs mail/indexed files: new or deeper pages, structured synthesis, conservative use of web for public facts.
2. **Lint** — tighten what exists: links, orphans, safe fixes, light hygiene (aligned with [OPP-015](./archive/OPP-015-wiki-background-maintenance-agents.md), [OPP-025](./archive/OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)).
3. **Repeat** — next lap starts with an **updated manifest** (paths in vault) + `me.md` + optional run notes.

**User controls:** **Pause / resume** at any time (hard stop on cost and churn). **Diminishing-returns** heuristics are **implemented** (no-op lap counter, inter-lap backoff, idle after 3 empty laps — see [pipeline doc](../architecture/your-wiki-background-pipeline.md)). **Aspirational** per-invocation caps (max tool calls, wall time, token ceilings) are **not** enforced in code yet.

**Relation to cron:** Cron or “when index sync completes” can remain **implementation triggers** or **fallback when the app was closed**; the **default story** for users is: **one pipeline**, not a calendar of unrelated tasks.

## “Your Wiki” — user-facing naming and states

**Product umbrella:** The user sees a single surface branded **Your Wiki** (not “wiki pipeline,” “build-out,” or “expansion” in primary copy). Subtitles and phase labels carry the detail.

**User-visible states**


| State                        | Meaning                                                                                                                                                                 | Copy direction (examples)                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Initial build**            | **One-time** first pass after onboarding (or after a factory reset that clears pages). Establishes the first draft of the personal wiki from profile + indexed sources. | Hub: **Your Wiki** · **Starting your first pages** · Detail: first draft from your profile and mail. |
| **Building out / enriching** | Ongoing **generative** phase of a lap: new or deeper pages, synthesis, gaps vs mail/files.                                                                              | Hub: **Your Wiki** · **Enriching** · Lap N · Detail: what file or theme is active.                   |
| **Cleaning up**              | Ongoing **lint / hygiene** phase of the same lap: links, orphans, safe fixes ([OPP-015](./archive/OPP-015-wiki-background-maintenance-agents.md)).                              | Hub: **Your Wiki** · **Cleaning up** · Lap N · Detail: e.g. link pass, last path touched.            |
| **Paused**                   | User halted the process; **no** LLM work in flight until resume.                                                                                                        | Hub: **Your Wiki** · **Paused**                                                                      |


After initial build completes, the **steady loop** is **enriching → cleaning up → (next lap) enriching → …**, still under **Your Wiki**.

**Pause and resume (contract)**

- **Pause** aborts the **current** agent invocation (build-out or lint) and leaves the wiki **as it is on disk** at the stop—no guarantee the lap “finished” enrich or cleanup.
- **Resume** always starts a **new lap** at **enriching / building out** — **not** mid-stream continuation of the interrupted session. Implementation: new agent run, fresh context, updated vault manifest + `me.md`; optionally increment lap counter or show “Lap N (started after resume).”
- Rationale: simpler mental model, avoids corrupted partial state in long contexts, matches **bounded chunks** (see **Unified wiki pipeline** above).

## Lint: bake into one agent vs separate agents in sequence?

**Recommendation: keep build-out and lint as separate *invocations* (separate system prompts or two named agent profiles), orchestrated in sequence by a thin supervisor — not a single combined prompt that tries to do both at once.**


| Approach                                                              | Pros                                                                                                                   | Cons                                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **All-in-one prompt** (“expand, then review your work at the end”)    | One session object; fewer moving parts in code                                                                         | Conflicting objectives (add content vs minimize edits); hard to tune budgets; **lint** quality suffers when buried; harder to test and log |
| **Light self-check at end of build-out**                              | Catches obvious mistakes on files **just touched**                                                                     | Not a substitute for **vault-wide** lint (orphans elsewhere, global link graph)                                                            |
| **Build-out run → then lint run → repeat** (same or different binary) | Clear contracts, **conservative** lint separate from **generative** build-out, per-phase token limits, clear telemetry | Needs a small **orchestrator** (state machine / job queue)                                                                                 |


So: **do not** rely only on “please review your work” inside the build-out prompt for **full** maintenance value. **Do** run a **dedicated lint pass** after build-out each lap (or every *k* laps if lint is expensive). Optionally allow a **short** self-review instruction at the end of build-out **only** for pages edited in that phase; still run **lint** as its own step.

### Lint inputs and cadence (2026)

Karpathy’s **lint** step aligns here with **batch maintenance on supervisor laps**, not with running a **second cleanup agent after every chat message**.

- **Chat → durable log:** Successful wiki **`write` / `edit` / `move_file` / `delete_file`** from the main assistant append rows to **`$BRAIN_HOME/var/wiki-edits.jsonl`** ([`wikiEditHistory.ts`](../../src/server/lib/wiki/wikiEditHistory.ts)).
- **Enrich** already consumes a **recent tail** of that file (injected context in [`buildExpansionContextPrefix`](../../src/server/agent/wikiExpansionRunner.ts)) so deepen/buildout laps prioritize pages the user recently touched.
- **Cleanup** today anchors on **`changedFiles` produced by the enrich phase** of each lap (`runCleanupInvocation` after enrich in the supervisor loop). Chat-only edits are **visible in the vault and in the edit log**, but structural link/orphan hygiene for those paths waits until the **next** cleanup invocation unless enrich touches them—in line with narrower **chat-first authoring** prompts.
- **Open engineering:** merge **recent `wiki-edits.jsonl` paths** (or a “since last cleanup” watermark) into the **`changedFiles`** input for **`runCleanupInvocation`**, optional union with enrich outputs, so the **same cleanup agent** covers chat-authored surfaces **without** the retired post-turn job ([archived OPP-062](./archive/OPP-062-post-turn-wiki-touch-up-agent.md)).

The **user-facing** surface remains **one process** (**Your Wiki**); implementation is **sequenced specialists**, not one confused generalist.

## UX implications (what would need to change)

Product and engineering should converge on **one inspectable background process** — **Your Wiki** — with **initial build** vs **ongoing lap** and **phase** visibility:


| Area                              | Change                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brain Hub / background agents** | **One** primary row: **Your Wiki**. Status shows **initial build** (once) vs **Enriching** / **Cleaning up** (ongoing lap phases) vs **Paused**. **Idle** when not running and not paused (user can start from Hub).                              |
| **Drill-down**                    | Header **Your Wiki**; body shows **phase** (initial build | enriching | cleaning up), **lap** when not initial build, **last activity** (e.g. path). Default **current lap / current run** only; history optional.                                |
| **Single process to inspect**     | One timeline / run ID per user-facing process. Internally: separate **enrich** vs **cleanup** agent invocations per lap; **orchestrator** owns pause, budgets, and **resume → new lap at enriching** (see **Pause and resume (contract)** above). |
| **Pause / resume**                | One **Pause** / **Resume** control. **Resume** does **not** continue the interrupted agent—always **new lap at enriching** (see above).                                                                                                           |
| **Onboarding / first-run**        | First experience after accept-profile: **Your Wiki** · **Starting your first pages** (initial build). Later: same Hub row, copy shifts to **Enriching** / **Cleaning up** ([OPP-027](./archive/OPP-027-wiki-nav-indicator-and-activity-surface.md)).      |


**Open UX detail:** Whether **cleanup every lap** or **every k laps** is a product toggle; phase label **Cleaning up** still applies when that phase runs.

**Internal vs user strings:** Code and docs may still say `wiki-expansion`, `seeding`, `lint` — user copy should stay **Your Wiki** + **Enriching** / **Cleaning up** / **Starting your first pages** / **Paused**.

## Synthesis of gaps (discussion + code review)


| Theme | Gap | Notes |
| ----- | --- | ----- |
| **Cleanup anchors** | Chat-only `wiki-edits.jsonl` paths may wait until enrich touches the same file before lap cleanup runs. | **Open:** merge recent log paths into `runCleanupInvocation` anchors ([Lint inputs](#lint-inputs-and-cadence-2026) below). |
| **Per-lap budgets** | No hard max tool calls / wall time per enrich or cleanup invocation. | **Open:** optional ceilings in supervisor or pi-agent config. |
| **Onboarding UX** | No wizard “wait until N wiki pages”; background work runs while user is in app. | Product choice: progress / gates vs throughput. |
| **Operations** | Karpathy: **index + log**, **lint**, **file good answers back** from chat. | Supervisor loop + `wiki-edits.jsonl` shipped; metrics / discovery UI still [OPP-026](./archive/OPP-026-knowledge-expansion-discovery-ui.md). |
| **Schema** | Single maintainer constitution vs split prompts. | Brain splits buildout / cleanup / chat / bootstrap prompts. |
| **Eval** | Small wikis under-test compounding. | See [the-wiki-question.md](../the-wiki-question.md), [wiki-and-agent-evaluation.md](../wiki-and-agent-evaluation.md). |

**Resolved (do not reopen here):** `me.md` / manifest injection for enrich ([archived BUG-011](../bugs/archive/BUG-011-wiki-expansion-missing-me-md-context.md)); buildout has `read` / `grep` / `find`; bootstrap is a separate agent with bounded `write`.


## Relationship to existing work


| ID                                                                         | Role                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [OPP-015](./archive/OPP-015-wiki-background-maintenance-agents.md)                 | **Lint / scheduled maintenance** — Karpathy “health check” angle; keep as execution track.                                       |
| [OPP-025](./archive/OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md) | **Hygiene** after edits — complements expansion.                                                                                 |
| [OPP-026](./archive/OPP-026-knowledge-expansion-discovery-ui.md)                   | **User-reviewed expansion** — supervision Karpathy prefers on ingest; complements blind background passes.                       |
| [OPP-027](./archive/OPP-027-wiki-nav-indicator-and-activity-surface.md)            | **Activity surface** for background wiki work — user visibility when not blocking onboarding.                                    |
| [OPP-032](./archive/OPP-032-brain-hub-wiki-rebuild-and-factory-reset.md)           | **Rebuild + re-expand** — recovery when compounding goes wrong.                                                                  |
| [archive/OPP-006](./archive/OPP-006-email-bootstrap-onboarding.md)         | Historical **profiling → review → seeding**; current path is **review → accept → background expansion** (see onboarding routes). |


## Proposal (phased)

### Phase 0 — Unblock correctness (historical; BUG-011 archived)

- Inject `**me.md`** (and any other must-have context) into **background wiki expansion** and, if needed, **interactive seeding**—reuse the same pattern as `meProfilePromptSection` in `[assistantAgent.ts](../../src/server/agent/assistantAgent.ts)` or prepend to the first user turn in `[wikiExpansionRunner.ts](../../src/server/agent/wikiExpansionRunner.ts)`.
- **Acceptance:** expansion run produces pages **consistent with accepted profile** without relying on lucky mail search.

### Phase 1 — Bootstrap agent can *maintain* what it creates

- **Option A:** Allow **read-only** vault tools for a **narrow** allowlist (`me.md`, optional `people/`* skeleton) during expansion, or **Option B:** Keep tools restricted but **inject** file contents at session start.
- Tighten **initial vs continue** prompts (`[wikiExpansionRunner.ts](../../src/server/agent/wikiExpansionRunner.ts)`) so the first pass behaves like **structured ingest**, not a generic “expand forever” chat.

### Phase 2 — Close the Karpathy triangle (without duplicating OPP-015/026)

- **Query → file back:** Prompt nudges + optional UI for “save this answer to the wiki” on high-value turns (can start as prompt-only).
- **Index + log:** Encourage or auto-update `**_index.md` / vault index** and **changelog** conventions so agents and users can navigate at scale (partially present in wiki UI; make it **agent-operational**).
- **Contradiction / staleness:** Feed **maintenance** agents ([OPP-015](./archive/OPP-015-wiki-background-maintenance-agents.md)) with explicit **wiki vs ripmail spot-check** policies—not only broken links.

### Phase 3 — Product clarity (optional)

- Revisit **post-accept** experience: e.g. **non-blocking** progress (Hub / nav indicator) vs **soft gate** (“wiki still warming up”)—trade latency vs confidence; align with [OPP-027](./archive/OPP-027-wiki-nav-indicator-and-activity-surface.md).
- Implement **Your Wiki** in Hub (see **UX implications** and **“Your Wiki” — user-facing naming and states**): **initial build**, then **Enriching** / **Cleaning up**, **Paused**, **Resume** → new lap at **Enriching**.

### Phase 4 — Measurement

- Define **one or two** internal metrics: e.g. **contradiction probes**, **repeat-question cost** (with vs without wiki), or **page graph density** over time—enough to validate [the-wiki-question.md](../the-wiki-question.md) hypotheses.

## Non-goals (for this OPP)

- Replacing the **substance** of [OPP-015](./archive/OPP-015-wiki-background-maintenance-agents.md) (what lint *does*) or [OPP-026](./archive/OPP-026-knowledge-expansion-discovery-ui.md) (reviewed expansion)—this OPP is **orchestration and UX**; lint remains a **distinct** phase with its own prompt and safety profile.
- A **second** philosophical doc; link **from** here **to** [the-wiki-question.md](../the-wiki-question.md) for the full question framing.

## Success criteria (umbrella)

- First wiki expansion after onboarding is **measurably better** (profile alignment + link quality) after Phase 0–1.
- Team can **name** the compounding loop in roadmap terms: **batch wiki ingest (expansion) / query+file (chat) / lint (maintenance)**, with existing OPPs mapped—**not** per-email LLM ingest (see **Ingest cadence** above). Users see **Your Wiki** (initial build once, then **Enriching → Cleaning up** in laps, **Paused** as needed; **Resume** starts a **new** lap at **Enriching**).
- Eval or dogfooding at **non-tiny** wiki size validates **network** value before betting the UX farm.