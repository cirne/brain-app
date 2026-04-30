**Archived: Retired (2026-04-30).** Post-turn wiki touch-up (**async cleanup after every vault-mutating chat turn**) was **removed from the product** to cut cost, complexity, and chat chrome. **Replacement direction:** structural wiki mutations are logged in **`var/wiki-edits.jsonl`** ([`wikiEditHistory.ts`](../../../src/server/lib/wiki/wikiEditHistory.ts)); **Your Wiki** runs **enrich → cleanup** on **supervisor laps**; **future work** is to feed **recent log-derived paths** (and/or an explicit checkpoint) into **`runCleanupInvocation`** so chat-authored pages get **batch** link/hygiene passes without a second agent at **message** cadence — see [OPP-033](../OPP-033-wiki-compounding-karpathy-alignment.md) **Lint inputs and cadence (2026)**.

---

# OPP-062: Post-turn wiki touch-up (async maintenance on files just written)

**Status (historical):** **Implemented (core, 2026-04-29); retired (2026-04-30)** — see archived banner above.

## Summary

**Lint / cleanup always takes a required input: the set of wiki paths that were created or modified** in the immediately preceding writer (main chat turn, Your Wiki **enrich** phase, or another supported producer). That set **focuses** the pass; the agent still **follows the graph**—broken `[[wikilinks]]`, obvious index/orphan fixes, etc. may require **reading and editing other files**. The prompt makes the changed-files list the **starting anchor**, not a guarantee that edits stay only on those paths.

After a **main assistant** turn that touches the vault, enqueue a **small, asynchronous** touch-up that reuses the **same** cleanup stack with `changedFiles` from that turn. This is **not** a second Your Wiki lap and not a mail re-ingest; it complements [OPP-033](../OPP-033-wiki-compounding-karpathy-alignment.md) and the **Karpathy “lint”** idea ([LLM Wiki](../../karpathy-llm-wiki-post.md)) at **human-message cadence** as well as tightening **supervisor** cleanup (see **Lint input contract** below).

## Motivation

- **Trust:** High-stakes wiki content (travel, meetings, commitments) should not rely solely on the drafting model’s last pass. A **fast follow-up** with a **narrow prompt** and **tight scope** can catch link rot, orphan edges, and overconfident prose **while context is hot**.
- **Compounding:** The wiki stays usable if every write gets a **light bookkeeping** pass—aligned with “lint” in Karpathy’s ingest / query / lint loop—without waiting for the **Your Wiki** supervisor’s next enrich/cleanup lap.
- **Separation of concerns:** Main chat optimizes for user intent and throughput; touch-up optimizes for **consistency and hygiene** on **just-touched** surfaces, similar in spirit to OPP-033’s “short self-check on files just touched” recommendation— but **as a dedicated invocation** with its own budget and telemetry instead of burying it in the main turn.
- **One lint contract:** The same **changed-files → cleanup** API avoids two unrelated “lint philosophies” in code—the supervisor’s post-enrich cleanup and post-chat touch-up differ only in **where `changedFiles` comes from** and in **budgets**, not in agent identity.

## Lint input contract (cleanup agent)

- **Required argument:** `changedFiles: string[]` — vault-relative paths that were **created or modified** (`write` / `edit`; include `move_file` / `delete_file` outcomes per product policy) in the **preceding** writer session.
- **Prompt behavior:** Open with that list: “These files just changed; prioritize link hygiene, consistency, and safe fixes **starting from** this set.” The model is explicitly allowed to **open and edit related pages** when fixing broken links, orphan/index alignment, or cross-page duplication—those files were not necessarily in `changedFiles`.
- **Supervisor ([OPP-033](../OPP-033-wiki-compounding-karpathy-alignment.md)):** After each **enrich** (buildout) invocation, **`changedFiles` from enrich is passed into [`runCleanupInvocation`](../../../src/server/agent/yourWikiSupervisor.ts)** (delta vs full-vault mode when the set is empty).
- **Optional full-vault mode:** Periodic or explicit “lint the whole vault” runs can pass **empty** `changedFiles` only when paired with an explicit **full-vault** instruction and budget—so the default path stays **delta-anchored**.

## Why this is different from existing flows


| Surface                                                                             | `changedFiles` source                                        | Trigger                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| **Your Wiki cleanup** ([OPP-033](../OPP-033-wiki-compounding-karpathy-alignment.md)) | Paths written/edited during the **enrich** phase of that lap | After each enrich in the supervisor loop    |
| **Main chat**                                                                       | Paths touched by user-visible assistant tools in that turn   | Every message that mutates the vault        |
| **Post-turn touch-up (this OPP)**                                                   | Same as main-chat row; async job so SSE is not blocked       | **agent_end** when wiki tools changed files |


Archived **background maintenance** ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md)) was folded into Your Wiki; this proposal adds **delta-anchored cleanup input** everywhere lint runs, plus **higher-frequency** follow-up on chat writes.

## Product stance

- **Default on** (with budgets), or user-toggle under Hub / settings if cost or trust preferences demand it.
- **Visibility:** Do **not** append touch-up output to the chat transcript. Prefer **chat chrome** (see **Chat header: wiki touch-up control** below) so users can see activity and inspect results without conflating touch-up with **Your Wiki** in the Hub.
- **Autonomy tier:** Start with **auto-apply safe fixes** (broken wikilink targets that have an obvious rename, orphan stubs that only need one inbound link) and **qualify or flag** uncertain factual claims rather than silently “correcting” trip times. Align with trust rules in [wiki-read-vs-read-email.md](../../architecture/wiki-read-vs-read-email.md): touch-up may **suggest** mail re-check for time-sensitive facts but should not spawn an unbounded evidence hunt by default (that stays **main chat** / `/research`).

## Chat header: wiki touch-up control (**shipped**)

**Placement:** In the **main chat** header / toolbar—**immediately left of** the existing **sound on/off** control (and the trash / clear control)—see [`AgentChat.svelte`](../../../src/client/components/AgentChat.svelte) (`wiki-polish-slot`, Lucide `Sparkles`). **Removed 2026-04-30.**

**Running state:** Animated / busy styling while status is **queued** or **running** (`wikiPolishBusy`).

**Menu (click to open):** Dropdown lists **anchor + edited paths** from the latest run (capped). **Polishing…** copy while busy.

**Navigation:** Rows open the wiki page in the existing overlay / pane flow.

**Lifecycle + data (removed):** `GET /api/chat/wiki-touch-up/:sessionId`, `wikiTouchUpJob.ts`, and related UI were deleted with this retirement.

**Follow-on polish (optional):** `appEvents` (`wiki:mutated`) could replace or narrow polling further; Hub-style history across many runs is still a product knob.

## Technical approach (sketch)

### 1. Detect “wiki touched” at end of turn

- In the main chat SSE pipeline ([`streamAgentSse.ts`](../../../src/server/lib/chat/streamAgentSse.ts)), **`agent_end`** (or equivalent completion path) already participates in persistence via `onTurnComplete`.
- Extend tracking: from **`tool_execution_start` / `tool_execution_end`** (existing handlers in [`streamAgentSseHandlers.ts`](../../../src/server/lib/chat/streamAgentSseHandlers.ts)), collect **relative wiki paths** for wiki mutating tools, analogous to `attachRunTracker` in [`wikiExpansionRunner.ts`](../../../src/server/agent/wikiExpansionRunner.ts) (which already watches `write` / `edit` for background runs).
- Normalize paths with existing helpers (`safeWikiRelativePath`, wiki root resolution) so only vault-under-root paths enqueue work.

### 2. Enqueue async job (don’t block the user’s SSE)

- On turn completion, if the touched-path set is non-empty, **enqueue** a per-tenant job: `{ sessionOrTurnId, workspace, paths[], trigger: 'post_chat_turn' }`.
- **Debounce / coalesce:** If the user sends another message before the job runs, merge path sets or prefer **latest turn** within a short window to avoid pile-up.
- **Guards:** Skip if Your Wiki supervisor is **already** running cleanup on overlapping paths (optional lock or “supervisor wins”); skip if user **paused** automation; skip for **onboarding-only** agents if they already run a dedicated cleanup.

### 3. Executor: one cleanup agent, always pass `changedFiles`

- **Reuse** the wiki cleanup agent stack and tool set (read/grep/edit/find under vault—see [`wikiExpansionRunner`](../../../src/server/agent/wikiExpansionRunner.ts) `runCleanupInvocation`, [`wiki/cleanup.hbs`](../../../src/server/prompts/wiki/cleanup.hbs)).
- **API shape:** e.g. `runCleanupInvocation({ runId, doc, timezone, changedFiles })` (exact signature TBD). Inject **`changedFiles` into the user message** (or template) every time—whether the job is **post-enrich** (supervisor), **post-chat** (touch-up), or a deliberate full-vault pass (empty list + explicit “vault-wide” mode).
- **Prompt:** Anchor on `changedFiles`; instruct the model to **trace wikilinks and hub/index** as needed so broken links and orphans can be fixed even when the fix lives outside the set. **Do not** pretend the set is the only files that may be edited—only that it is the **focus**.
- **Budgets:** Hard cap **tool rounds**, **wall time**, and **tokens** (smaller model tier optional for post-chat); **max files edited** per run where product requires.
- **Idempotency:** Job key per turn or per supervisor lap; log outcome to structured logging / optional `BackgroundRunDoc`-lite record for Hub.

### 4. Recursion / thrash control

- Touch-up runs must **not** enqueue another touch-up from their own tool events (tag executor: `source: 'wikiTouchUp'` and filter).
- If touch-up **writes** only trivial fixes, a second generation of jobs could still be noisy—prefer **single** touch-up per originating chat turn, or **cooldown** per path (e.g. same path not re-touched within N minutes except from user chat).

### 5. Accuracy-heavy content (optional escalation)

- Phase 1: link hygiene, Obsidian link style, obvious duplication stubs, “confidence” callouts—**no** full `search_index` pass.
- Phase 2 (flag-gated): allow **targeted** `search_index` / `read_email` **only** when the touched page matches templates (e.g. trip / briefing) and the prompt mandates recency checks—ties to [the-wiki-question.md](../../the-wiki-question.md) reliability rules.

## Risks

- **Cost and latency:** Every wiki-editing chat turn adds LLM usage; budgets and opt-out are mandatory.
- **Fighting the user:** Auto-edits right after the user accepts a turn may feel uncanny; consider **diff preview** or **suggest-only** mode until trust is high.
- **Model variance:** Small passes can still hallucinate “fixes”; conservative prompts and **prefer no change** when unsure.

## Implementation status (2026-04-29)

| Area | State | Notes |
| --- | --- | --- |
| Lint input contract (`changedFiles`) | **Shipped** | [`runCleanupInvocation`](../../../src/server/agent/wikiExpansionRunner.ts), prompts [`wiki/cleanup.hbs`](../../../src/server/prompts/wiki/cleanup.hbs). |
| Supervisor post-enrich cleanup | **Shipped** | [`yourWikiSupervisor.ts`](../../../src/server/agent/yourWikiSupervisor.ts) passes enrich `changedFiles` (or full-vault when empty). |
| Main-chat path tracking | **Shipped (then removed)** | Was in [`streamAgentSse.ts`](../../../src/server/lib/chat/streamAgentSse.ts) + handlers; enqueue path retired 2026-04-30. |
| Async post-chat job | **Removed** | Former `wikiTouchUpJob.ts` — replaced by supervisor-lap cleanup + **`wiki-edits.jsonl`** direction (see archive banner). |
| No recursive enqueue from touch-up | **N/A** | Feature retired. |
| Chat header + polling | **Removed** | Sparkles polish control removed from chat header. |
| User opt-out / Hub toggle | **Not shipped** | Doc “default on or user-toggle” — no setting yet. |
| Optional guards (supervisor overlap, onboarding) | **Not shipped** | Marked optional in original spec. |
| Telemetry (completion rate, p50 duration, dashboards) | **N/A** | `wiki_touch_up` agent kind removed; supervisor cleanup remains `wiki_cleanup`. |
| Wiki eval fixtures for touch-up | **Not shipped** | Success-criteria “eval hook” still future. |
| Phase 2: targeted `search_index` / mail | **Deferred** | Explicitly non-goals / phase 2 in doc body. |

## Success criteria

- **Chat header control:** Users can see **touch-up running** (animated icon) and **inspect recent polish results** (dropdown → open wiki paths) without Hub or transcript noise; naming distinguishes **Your Wiki** from **chat wiki polish**.
- Every cleanup invocation (supervisor or touch-up) logs or records the **`changedFiles`** input for debugging and eval reproducibility.
- Broken `[[wikilinks]]` count trends **down** on recently edited pages (measurable + spot checks).
- No significant increase in **user-visible** errors or complaints about surprise rewrites (qualitative).
- Telemetry: touch-up **completion rate**, **median duration**, **tools per job**, **edits per path**—comparable across models.
- **Eval hook:** Extend wiki/agent evals ([wiki-and-agent-evaluation.md](../../wiki-and-agent-evaluation.md)) with fixtures where the main turn introduces a bad link or stale time; cleanup pass **fixes or flags** per gold criteria (at **lap** cadence, not post-message).

## Related

- [OPP-033](../OPP-033-wiki-compounding-karpathy-alignment.md) — Your Wiki supervisor; enrich → cleanup.
- [Wiki vs mail](../../architecture/wiki-read-vs-read-email.md) — evidence vs synthesis; touch-up respects the contract.
- [the-wiki-question.md](../../the-wiki-question.md) — when the wiki must not **terminate** evidence lookup (escalation stays bounded here).
- [OPP-034](../OPP-034-wiki-snapshots-and-point-in-time-restore.md) — if aggressive auto-fix ships, snapshots matter more.

## Non-goals (v1)

- Replacing **Your Wiki** laps or running **full-vault** maintenance on every message.
- Guaranteeing **semantic** correctness against mail without explicit product policy for **targeted** re-fetch.
- Blocking the main chat stream until touch-up finishes.

