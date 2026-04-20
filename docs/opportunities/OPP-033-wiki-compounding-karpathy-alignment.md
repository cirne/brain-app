# OPP-033: Wiki compounding loop and Karpathy alignment

## Why this exists

Several threads converge on the same risk: **ripmail is rich ground truth**, but the **wiki’s reason to exist** is **amortized synthesis** (cross-links, stable entity pages, explicit contradictions, compounding over time)—not a second copy of mail. Andrej Karpathy’s **[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)** pattern stresses **ingest → query → lint**, a **persistent compounding artifact**, and **bookkeeping at scale** (many files per pass). Brain’s [VISION.md](../VISION.md) cites that inspiration; [the-wiki-question.md](../the-wiki-question.md) poses open questions about **when** the wiki pays off vs **re-querying mail**.

This opportunity is the **product/engineering umbrella** for closing the gap: **make the wiki earn its keep** without opening ten separate initiatives.

## How existing agents fit (expansion vs maintenance)


| Agent / flow (today or specified)                                                                                                                        | Karpathy-ish role                                                                                                | When it runs                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Wiki expansion** (`[wikiExpansionRunner](../../src/server/agent/wikiExpansionRunner.ts)` + seeding agent)                                              | **Batch “ingest” into the wiki** — turn indexed mail (+ web, etc.) into many linked pages in one or a few passes | After **accept-profile**, **Brain Hub “Full expansion”**, **Continue** — user- or setup-initiated, **not** per message             |
| **Maintenance** ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md), [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)) | **Lint** — link health, drift, safe fixes, coalesced hygiene                                                     | **Periodic** (cron) or **event-threshold** (e.g. changelog size, **mail index completion** as a batch event—not one job per email) |
| **Discovery / reviewed expansion** ([OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md))                                                            | **Supervised ingest** — structured suggestions, user excludes privacy before writes                              | User opens the flow; execution may call the **same** expansion/maintenance stack                                                   |
| **Main chat assistant**                                                                                                                                  | **Query** + optional **file-back** (wiki tools when useful); **ripmail** always available for evidence           | Every session                                                                                                                      |


So **expansion** is the heavy **initial / explicit** wiki buildout; **maintenance** is the **ongoing gardener**; **chat** is the default **query** surface. [OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md) is where background work surfaces without blocking the main UI.

## Ingest cadence: Brain vs Karpathy (important distinction)

Karpathy’s gist often reads as **ingest each new source** into the wiki soon after it lands, sometimes **one file at a time** with the human watching—reasonable when “sources” are articles, PDFs, or clipped pages at **human scale**.

Brain’s **source** is mostly **email (and more) at mailbox scale**. Re-running a full wiki **ingestion** agent on **every new message** would be **noise-heavy**, expensive, and would fight users who already have **fast indexed search** (`search_index`, `read_doc`) for raw evidence. The intended shape is:

- **Continuous / automatic:** **ripmail (and friends) keep the corpus indexed** — this is the always-on layer, not an LLM loop per mail.
- **One setup + periodic / batch wiki updates:** **expansion** after profile accept or on demand; **maintenance** on a schedule or **coarse** triggers (sync finished, weekly lint, Hub “run now”); optional **larger** passes when the user asks or approves ([OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md)).

So the analogy is **not** “LLM ingest ≡ every new email.” It is: **index stays fresh automatically; the wiki is updated in deliberate batches** so synthesis **compounds** without becoming a spam cannon. OPP-033’s “ingest” language means **wiki ingest**, **not** re-indexing mail. Success criteria below use **query / file-back / lint** where **lint + periodic expansion** replace Karpathy’s **per-source ingest** at mail cadence.

## Unified wiki pipeline (continuous loop — preferred UX simplification)

Instead of exposing **separate** “expansion” vs “maintenance cron” mental models, the product can offer **one long-running wiki process** while Brain is active (or user-requested):

1. **Build-out** — close gaps vs mail/indexed files: new or deeper pages, structured synthesis, conservative use of web for public facts.
2. **Lint** — tighten what exists: links, orphans, safe fixes, light hygiene (aligned with [OPP-015](./OPP-015-wiki-background-maintenance-agents.md), [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)).
3. **Repeat** — next lap starts with an **updated manifest** (paths in vault) + `me.md` + optional run notes.

**User controls:** **Pause / resume** at any time (hard stop on cost and churn). **Not** “unbounded”: each **lap** and the **overall run** still use **budgets** (turns, tool calls, wall time, token ceilings) and optional **diminishing-returns** heuristics (if a lap adds almost nothing, back off or require user nudge). This is **continuous orchestration** of **bounded chunks**, not one infinite LLM context.

**Relation to cron:** Cron or “when index sync completes” can remain **implementation triggers** or **fallback when the app was closed**; the **default story** for users is: **one pipeline**, not a calendar of unrelated tasks.

## “Your Wiki” — user-facing naming and states

**Product umbrella:** The user sees a single surface branded **Your Wiki** (not “wiki pipeline,” “build-out,” or “expansion” in primary copy). Subtitles and phase labels carry the detail.

**User-visible states**


| State                        | Meaning                                                                                                                                                                 | Copy direction (examples)                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Initial build**            | **One-time** first pass after onboarding (or after a factory reset that clears pages). Establishes the first draft of the personal wiki from profile + indexed sources. | Hub: **Your Wiki** · **Starting your first pages** · Detail: first draft from your profile and mail. |
| **Building out / enriching** | Ongoing **generative** phase of a lap: new or deeper pages, synthesis, gaps vs mail/files.                                                                              | Hub: **Your Wiki** · **Enriching** · Lap N · Detail: what file or theme is active.                   |
| **Cleaning up**              | Ongoing **lint / hygiene** phase of the same lap: links, orphans, safe fixes ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md)).                              | Hub: **Your Wiki** · **Cleaning up** · Lap N · Detail: e.g. link pass, last path touched.            |
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

The **user-facing** surface remains **one process** (**Your Wiki**); implementation is **sequenced specialists**, not one confused generalist.

## UX implications (what would need to change)

Product and engineering should converge on **one inspectable background process** — **Your Wiki** — with **initial build** vs **ongoing lap** and **phase** visibility:


| Area                              | Change                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brain Hub / background agents** | **One** primary row: **Your Wiki**. Status shows **initial build** (once) vs **Enriching** / **Cleaning up** (ongoing lap phases) vs **Paused**. **Idle** when not running and not paused (user can start from Hub).                              |
| **Drill-down**                    | Header **Your Wiki**; body shows **phase** (initial build | enriching | cleaning up), **lap** when not initial build, **last activity** (e.g. path). Default **current lap / current run** only; history optional.                                |
| **Single process to inspect**     | One timeline / run ID per user-facing process. Internally: separate **enrich** vs **cleanup** agent invocations per lap; **orchestrator** owns pause, budgets, and **resume → new lap at enriching** (see **Pause and resume (contract)** above). |
| **Pause / resume**                | One **Pause** / **Resume** control. **Resume** does **not** continue the interrupted agent—always **new lap at enriching** (see above).                                                                                                           |
| **Onboarding / first-run**        | First experience after accept-profile: **Your Wiki** · **Starting your first pages** (initial build). Later: same Hub row, copy shifts to **Enriching** / **Cleaning up** ([OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md)).      |


**Open UX detail:** Whether **cleanup every lap** or **every k laps** is a product toggle; phase label **Cleaning up** still applies when that phase runs.

**Internal vs user strings:** Code and docs may still say `wiki-expansion`, `seeding`, `lint` — user copy should stay **Your Wiki** + **Enriching** / **Cleaning up** / **Starting your first pages** / **Paused**.

## Synthesis of gaps (discussion + code review)


| Theme             | Gap                                                                                                                                                                                          | Notes                                                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Initial build** | Background wiki expansion reuses the **seeding** agent but the kickoff message says “anchor on `me.md`” while the model **does not receive** `me.md` in context (unlike the main assistant). | Treat as **BUG** until fixed: [BUG-011](../bugs/BUG-011-wiki-expansion-missing-me-md-context.md).                                                                                                                                                                                               |
| **Tooling**       | Seeding/expansion **omit** wiki `read` / `grep` / `find` so the agent cannot do Karpathy-style **cross-page maintenance** during bootstrap.                                                  | Either **inject** must-read content (profile, skeleton paths) and/or **narrowly allow** vault read for maintenance passes.                                                                                                                                                                      |
| **Onboarding UX** | The old **wait until N wiki pages** wizard step was **removed**; accept-profile goes **straight to `done`** while expansion runs in the background.                                          | Throughput ↑, **felt** “wiki is ready” ↓; optional **gate or progress** is a product choice, not nostalgia.                                                                                                                                                                                     |
| **Operations**    | Karpathy: **index + log**, **lint**, **file good answers back** from chat.                                                                                                                   | Partially covered by [OPP-015](./OPP-015-wiki-background-maintenance-agents.md), [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md), [OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md)—but **not** wired as one coherent “compounding loop” narrative or metric. |
| **Schema**        | Karpathy co-evolves a **single maintainer constitution** (e.g. `AGENTS.md`-style).                                                                                                           | Brain splits rules across **seeding**, **profiling**, **main assistant** prompts—works, but **consistency** across agent kinds is weaker.                                                                                                                                                       |
| **Eval**          | Small local wikis (10–20 pages) **under-test** network effects.                                                                                                                              | Deliberate **larger-vault** tests or benchmarks (see [the-wiki-question.md](../the-wiki-question.md)) before big UX investment.                                                                                                                                                                 |


## Relationship to existing work


| ID                                                                         | Role                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [OPP-015](./OPP-015-wiki-background-maintenance-agents.md)                 | **Lint / scheduled maintenance** — Karpathy “health check” angle; keep as execution track.                                       |
| [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md) | **Hygiene** after edits — complements expansion.                                                                                 |
| [OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md)                   | **User-reviewed expansion** — supervision Karpathy prefers on ingest; complements blind background passes.                       |
| [OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md)            | **Activity surface** for background wiki work — user visibility when not blocking onboarding.                                    |
| [OPP-032](./OPP-032-brain-hub-wiki-rebuild-and-factory-reset.md)           | **Rebuild + re-expand** — recovery when compounding goes wrong.                                                                  |
| [archive/OPP-006](./archive/OPP-006-email-bootstrap-onboarding.md)         | Historical **profiling → review → seeding**; current path is **review → accept → background expansion** (see onboarding routes). |


## Proposal (phased)

### Phase 0 — Unblock correctness (ties to BUG-011)

- Inject `**me.md`** (and any other must-have context) into **background wiki expansion** and, if needed, **interactive seeding**—reuse the same pattern as `meProfilePromptSection` in `[assistantAgent.ts](../../src/server/agent/assistantAgent.ts)` or prepend to the first user turn in `[wikiExpansionRunner.ts](../../src/server/agent/wikiExpansionRunner.ts)`.
- **Acceptance:** expansion run produces pages **consistent with accepted profile** without relying on lucky mail search.

### Phase 1 — Bootstrap agent can *maintain* what it creates

- **Option A:** Allow **read-only** vault tools for a **narrow** allowlist (`me.md`, optional `people/`* skeleton) during expansion, or **Option B:** Keep tools restricted but **inject** file contents at session start.
- Tighten **initial vs continue** prompts (`[wikiExpansionRunner.ts](../../src/server/agent/wikiExpansionRunner.ts)`) so the first pass behaves like **structured ingest**, not a generic “expand forever” chat.

### Phase 2 — Close the Karpathy triangle (without duplicating OPP-015/026)

- **Query → file back:** Prompt nudges + optional UI for “save this answer to the wiki” on high-value turns (can start as prompt-only).
- **Index + log:** Encourage or auto-update `**_index.md` / vault index** and **changelog** conventions so agents and users can navigate at scale (partially present in wiki UI; make it **agent-operational**).
- **Contradiction / staleness:** Feed **maintenance** agents ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md)) with explicit **wiki vs ripmail spot-check** policies—not only broken links.

### Phase 3 — Product clarity (optional)

- Revisit **post-accept** experience: e.g. **non-blocking** progress (Hub / nav indicator) vs **soft gate** (“wiki still warming up”)—trade latency vs confidence; align with [OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md).
- Implement **Your Wiki** in Hub (see **UX implications** and **“Your Wiki” — user-facing naming and states**): **initial build**, then **Enriching** / **Cleaning up**, **Paused**, **Resume** → new lap at **Enriching**.

### Phase 4 — Measurement

- Define **one or two** internal metrics: e.g. **contradiction probes**, **repeat-question cost** (with vs without wiki), or **page graph density** over time—enough to validate [the-wiki-question.md](../the-wiki-question.md) hypotheses.

## Non-goals (for this OPP)

- Replacing the **substance** of [OPP-015](./OPP-015-wiki-background-maintenance-agents.md) (what lint *does*) or [OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md) (reviewed expansion)—this OPP is **orchestration and UX**; lint remains a **distinct** phase with its own prompt and safety profile.
- A **second** philosophical doc; link **from** here **to** [the-wiki-question.md](../the-wiki-question.md) for the full question framing.

## Success criteria (umbrella)

- First wiki expansion after onboarding is **measurably better** (profile alignment + link quality) after Phase 0–1.
- Team can **name** the compounding loop in roadmap terms: **batch wiki ingest (expansion) / query+file (chat) / lint (maintenance)**, with existing OPPs mapped—**not** per-email LLM ingest (see **Ingest cadence** above). Users see **Your Wiki** (initial build once, then **Enriching → Cleaning up** in laps, **Paused** as needed; **Resume** starts a **new** lap at **Enriching**).
- Eval or dogfooding at **non-tiny** wiki size validates **network** value before betting the UX farm.