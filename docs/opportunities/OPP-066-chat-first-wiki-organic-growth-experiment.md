# OPP-066: Chat-first wiki — organic growth experiment

**Status:** Partially shipped (2026-04-30). Core direction landed in `main`:
- ✅ Chat = **narrow capture** (`assistant/base.hbs` — question-scoped writes, `## Chat capture` stub, no hub tangents in chat)
- ✅ WikiBuilder gains **`read` / `grep` / `find`** tools — inspects existing vault before writing (`wikiBuildoutAgent.ts`, `wiki-buildout/system.hbs`)
- ✅ WikiBuilder **quality bar**: synthesize conclusions, no raw mail-volume stats, assistant-facing callouts
- ✅ **`wiki-edits.jsonl`** signal documented and in production (`wikiEditHistory.ts`, `shared/brain-layout.json`)
- ✅ **Onboarding** narrowed to identity-only (~2–3 min); people-pages phase removed — wiki discovers people through chat use
- ✅ **Eval clock** anchoring (`EVAL_ASSISTANT_NOW` / `resolveEvalAnchoredNow`) for historical-corpus evals
- ✅ Vault status bug fix (`getInboundOrAckedBrainSessionId`)

Remaining open work:
- 🔲 **OPP-067** — WikiBuilder deepen-only (no new-page creation); eligibility queue from `wiki-edits.jsonl` tail
- 🔲 Thin-page detector + lap-level work queue injection
- 🔲 **OPP-065** — LLM-as-judge eval scoring for wiki quality properties

**Related:** [OPP-033](./OPP-033-wiki-compounding-karpathy-alignment.md), [OPP-054](./OPP-054-guided-onboarding-agent.md), [OPP-062](./OPP-062-post-turn-wiki-touch-up-agent.md), [OPP-067](./OPP-067-wiki-buildout-agent-no-new-pages.md), [OPP-065](./OPP-065-wiki-eval-llm-as-judge.md), [OPP-011 (archived)](./archive/OPP-011-user-skills-strategy.md), `[wikiExpansionRunner](../../src/server/agent/wikiExpansionRunner.ts)`, `[wikiBuildoutAgent](../../src/server/agent/wikiBuildoutAgent.ts)`, [the-wiki-question.md](../the-wiki-question.md), [karpathy-llm-wiki-post.md](../karpathy-llm-wiki-post.md)
---

## Revised direction — chat capture vs WikiBuilder vs linter

**What we walked back**

- **Answer-first / async chat authoring** (defer heavy `write`, sub-agent handoffs from the main assistant prompt) is **not** the active path. That stacked competing objectives in one turn and complicated the assistant prompt without shipping a dedicated async runtime in product.

**Assistant (chat) — today’s contract**

- **Narrow, useful pages on the fly**: when mail/context supports it, **`write` or `edit`** while answering; content should match **the question’s scope**, not a full canonical person/project hub.
- **Provenance for downstream work**: new pages from chat should carry a short **`## Chat capture`** block (what triggered the page, timing/context, note that the page may be skeletal). This gives **WikiBuilder** a hook without requiring verbose prompts in every turn.
- **No “finish the hub in chat”**: avoid extra discovery-only mail passes for polish inside the same user turn; that belongs in background enrich.

**WikiBuilder (background enrich / buildout evolution) — intended job**

- **Primary mission:** **deepen and refresh pages that already exist** (or were just created in chat) so they become the **source of truth**: more mail-backed context, template alignment (`people/template.md`, etc.), recency, and relationship coverage.
- **Input signals:** Tail of **`wiki-edits.jsonl`** (or injected excerpt), **`## Chat capture`**, “new since last lap,” **thin page** heuristics—**not** open-ended “create pages for every entity in the inbox” on every lap.
- **Methods:** targeted **`search_index` / `read_email`**, re-read templates, expand stubs—same **tool family** as today’s enrich agent, but **tighter eligibility** so work stays anchored on **pages the user’s activity already touched**.

**Linter / cleanup — unchanged separation**

- **Cleanup agent / post-turn touch-up (OPP-062):** structural maintenance—**links, orphans, dedupe hints, index hygiene**—not the main place for “make this person page excellent via six mail searches.”

*Implementation of WikiBuilder rescoping is **documentation + future code**; assistant prompt and removal of chat-side “substance gate” behavior align product intent with narrow capture.*

---

## Where we are — conclusions from the first exploration round

We iterated on the **organic growth** hypothesis (chat-driven wiki ingest instead of only batch buildout) and pressure-tested it against real failure modes (e.g. narrow “Donna + Apple thread” pages instead of a **canonical person hub**).

**What held up**

- **Email-once / amortized synthesis** remains the right economic story: ripmail is fast; the valuable persistence is “don’t re-derive the same entity twice.”
- **Maintenance stack stays:** supervisor enrich → cleanup, post-turn touch-up (OPP-062), delta-anchored lint — still the right shell regardless of *who* authors pages first.
- **The tension is real:** optimizing the **immediate reply** in one agent turn biases toward **thin, stimulus-bound wiki pages**. That mirrors software engineering: **shipping the hack** (answer now) vs **paying down structure** (reusable person/project hub). Doing both in one synchronous turn fights itself.

**Direction we believe works** *(partially superseded by [Revised direction](#revised-direction--chat-capture-vs-wikibuilder-vs-linter); kept for history)*

1. **Split budgets by latency, not by lying about one objective.**
  - **Main chat agent:** answer the user quickly; minimal inline wiki mutation unless trivial or explicit.  
  - **Async wiki author (“sub-agent” job):** same *semantic* lineage as the turn (structured handoff), **forked** so it can spend extra `search_index` / wiki reads to produce **hub-quality** pages (whole-person, whole-project) **without** blocking TTFT.
2. **Reuse existing primitives.**
  Background wiki work already exists: `[wikiExpansionRunner](../../src/server/agent/wikiExpansionRunner.ts)`, `[backgroundAgentStore](../../src/server/lib/chat/backgroundAgentStore.ts)`, wiki buildout/cleanup agents. OPP-066’s next phase is **generalizing that pattern** from onboarding-oriented expansion to **opportunistic post-chat authoring** driven by a small **handoff contract** (entities, suggested queries, target paths, caps)—not inventing a separate runtime from scratch.
3. **Skills (optional but aligned).**
  `[load_skill](../../docs/opportunities/OPP-035-intent-based-skill-auto-loading.md)` can swap in a **tuned playbook** for “add page” vs “tidy vault” with different effort tiers and discover-first rules, without stuffing one mega-prompt. A separate `**wiki-add`** vs `**wiki-tidy**` skill (or one `/wiki` router loading two bodies) is compatible with this OPP; metadata helps routing when the user says “remember this” or `/wiki` + create intent.
4. **Guardrails to design explicitly**

  | Risk                                                   | Mitigation sketch                                                           |
  | ------------------------------------------------------ | --------------------------------------------------------------------------- |
  | Write conflicts (chat vs background editing same path) | Per-path serialization, merge policy, or draft → notify                     |
  | Silent creepy edits                                    | Opt-in, preview, structured activity / edit history, or explicit “enqueue wiki pass”         |
  | Runaway token cost                                     | Max turns / max mail searches / token budget per job                        |
  | Weak handoff                                           | Structured brief (not full transcript); entity type → template expectations |


**What “done” looks like for confidence**

We can say **dynamic wiki build-out works** when we have: (a) measurable **hub-quality** improvements vs inline-only authoring on benchmark cases (person thread → enriched `people/*`), (b) stable **job + telemetry** for async passes, (c) user-trust story (visibility or consent), and (d) harness coverage (extend wiki eval / LLM-judge paths per [OPP-065](./OPP-065-wiki-eval-llm-as-judge.md)).

---

## Background and motivation

### The current model

After onboarding, the `Your Wiki` supervisor launches an enrich → cleanup loop that processes the user's full inbox in background laps. The chat agent answers questions wiki-first then mail, and is loosely directed to "write or update the wiki when you learn something durable." Post-turn touch-up (OPP-062, shipped) runs a structural cleanup after any chat turn that touches the vault.

This works, but has a structural problem: **value is gated on buildout completion.** A real inbox produces a meaningful wiki only after many turns of the background supervisor — expensive in LLM tokens, slow (IMAP sync + many search_index calls per lap), and invisible to the user. With gpt-5.4-mini the token cost is manageable per turn, but aggregate over a full buildout it compounds quickly.

### The counterfactual (what this experiment tests)

What if we **never ran a big upfront buildout** and instead let the wiki grow entirely through use?

The hypothesis: **ripmail + search_index is already an excellent real-time evidence layer.** The wiki's value is not in having pages before questions are asked — it is in **not re-querying email for the same people and topics twice.** If the chat agent synthesizes a wiki page every time it does a substantial email investigation, the wiki self-populates at the rate questions are asked, at exactly the cost of answering those questions. No marginal buildout cost; no cold-start gate; no expensive background batch that produces pages the user may never need.

In Karpathy's framing: **the ingest cost becomes zero** because ingest is piggy-backed on query. The wiki is a persistent synthesis cache of answered questions, not a pre-compiled encyclopedia.

### What the maintenance agent actually does (and what it doesn't)

The supervisor (`yourWikiSupervisor.ts`) runs continuous enrich → cleanup laps, waking on mail sync or manual nudge. The cleanup agent (`wiki/cleanup.hbs`) does **structural lint**: broken wikilinks, orphan pages, index maintenance, light edits, and deduplication signals. Post-turn touch-up (OPP-062) fires the same cleanup stack at chat cadence.

**What the cleanup agent does not do:**

- Detect semantic contradictions *between* pages (only structural link integrity)
- Compare wiki claims against email to flag staleness
- Identify topics frequently queried in chat but missing from the wiki
- Maintain a durable **structured** record of what changed (today: **`wiki-edits.jsonl`** per tool write; future: enrich/lint attribution in the same or a sibling stream)

These are gaps regardless of the buildout model, but they matter more in the organic-growth model where wiki content is driven by chat patterns rather than a planned batch pass.

---

## The experiment

### Core idea: the email-once rule

> **When the chat agent queries email to investigate a specific person, project, or topic, it synthesizes those findings into a wiki page. On the next question about the same entity, the wiki is consulted first.**

This makes the wiki a *compiled query cache* for email lookups — exactly what Karpathy means by "amortized synthesis." The cost is paid once at question-answer time. Subsequent answers are cheaper and more consistent.

The chat agent already has the tooling (`write`, `edit`, `find`, `grep`, people templates) and a loose directive ("write when you learn something durable"). The experiment tightens this into a systematic rule in the system prompt.

---

## Onboarding simplification

This is the biggest downstream consequence of the chat-first model. The wiki buildout is currently the organizing force behind most of the onboarding conversation — it needs "important people" guidance, inbox rules to reduce noise, and calendar setup to contextualize events. Remove the buildout, and the conversation dramatically simplifies.

### What onboarding phases exist today and why

The current onboarding agent ([OPP-054](./OPP-054-guided-onboarding-agent.md)) runs five phases: identity, assistant name, calendars, inbox rules, and important people. In the chat-first model:


| Phase                  | Why it exists today                          | Chat-first model                                 |
| ---------------------- | -------------------------------------------- | ------------------------------------------------ |
| **Confirm identity**   | Write accurate `me.md`                       | Still needed — `me.md` is the assistant context  |
| **Name the assistant** | Write `assistant.md`                         | Still useful, same exchange as identity          |
| **Calendar setup**     | Remove noise before buildout reads calendar  | Deferred — "hide my shared calendars" in chat    |
| **Inbox rules**        | Reduce noise in buildout's email reads       | Deferred — `/inbox` or main chat on demand       |
| **Important people**   | Guide the buildout toward the right entities | **Eliminated** — wiki discovers them through use |


Three of five phases exist only to help the buildout. Without it, onboarding's single remaining job is: **write `me.md`** (and optionally name `assistant.md`).

### What the first conversation becomes

The onboarding conversation shrinks to a 2–3 minute identity confirmation that ends with `me.md` written and the user asking their first real question. The transition from "onboarding" to "normal chat" becomes invisible.

The agent does a quick mail recon (same as current: sent mail for name/signature/bio), presents a compact one-paragraph guess, invites correction, writes `me.md`, and asks what the user wants to know. The whole exchange is 3–5 turns. The user never sees "important people" chips, calendar lists, or inbox rule proposals. They just start using the product.

### The first real question is the first wiki ingest

Immediately after onboarding:

- User: "What's the status of the Henderson project?"
- Assistant searches email, reads 4 threads, synthesizes the answer.
- Because it read email about Henderson, it **writes `projects/henderson.md`** with the synthesis.
- The Henderson wiki page now exists. Next time someone asks, it's consulted first.

This is the organic wiki in action. The user gets a useful answer, pays the email query cost once, and the wiki grows by one page that directly corresponds to something they actually care about.

Compare that to the buildout model: the supervisor might also create a Henderson page, but only after processing dozens of other entities first, at a cost of many tokens for pages the user may never need.

### Onboarding state machine simplification

Current state machine (OPP-054):

```
idle → indexing → corpus gate (~200 msgs) → onboarding-interview (5 phases) → finalize (me.md) → wiki-buildout → done
```

Chat-first state machine:

```
idle → indexing → corpus gate (~10–50 msgs) → confirm-identity (me.md + assistant.md) → done
```

The corpus gate can drop dramatically — 10–50 messages is enough to infer a name, role, and email style for a confident first guess at `me.md`. The user doesn't need to wait for 200 messages before the first conversation.

After the identity confirmation, the supervisor starts in background but is expected to sit mostly idle at first. Chat drives wiki growth. The supervisor's enrich laps become relevant later — filling gaps the user hasn't asked about yet — rather than front-loading all the work.

### What happens to calendar and inbox rules setup

They move from onboarding rituals to **on-demand first-chat features**:

- User says "you seem to be pulling in a lot of noise from my Holidays calendar" → assistant hides it
- User says "can you stop surfacing newsletter emails?" → assistant creates an inbox rule

These feel more natural as responses to real friction the user encounters than as abstract configuration questions asked before they've used the product. The assistant is also better positioned to suggest the right rules after seeing what the user actually asks about.

---

## Chat agent changes

Implemented in `src/server/prompts/assistant/base.hbs`:

- **Narrow capture:** **`## Wiki: keep durable notes (chat = narrow capture)`** — write as you answer; stay **question-scoped**; do not expand into full hub synthesis in chat.
- **`## Chat capture`**: provenance stub on new pages for **WikiBuilder** to pick up later.
- **Wiki activity:** Documented in **`assistant/base.hbs`** — tools append to **`var/wiki-edits.jsonl`**; no markdown activity log maintained by the model.
- **Wiki first, then mail** at a high level unchanged; no answer-first / defer-`write` / `load_skill` mandate for hub depth.

## Structured wiki activity (`wiki-edits.jsonl`)

Because Braintunnel **owns the agent and tools**, wiki mutations are logged **server-side** as JSONL rows under **`$BRAIN_HOME/var/wiki-edits.jsonl`** ([`wikiEditHistory.ts`](../../src/server/lib/wiki/wikiEditHistory.ts); [`shared/brain-layout.json`](../../shared/brain-layout.json) `wikiEditsLog`). Each successful agent **`write`**, **`edit`**, **`move_file`**, and **`delete_file`** on the wiki appends a line (`ts`, `op`, `path`, `source`, …).

**WikiBuilder** (and UIs) should **tail or sample** this file—or receive a injected **tail** in the enrich prompt—rather than teaching the model to edit markdown `_log.md`. Legacy **`GET /api/wiki/log`** still parses optional vault-root **`_log.md`** for older vaults; do not seed or require `_log.md` for new product paths.

Example line shape:

```json
{"ts":"2026-04-29T12:00:00.000Z","op":"write","path":"people/jane-doe.md","source":"agent"}
```

**Benefits**

- Predictable, cheap, no markdown format drift from LLM edits
- Clear ordering for “what changed recently” / dedupe of enrich work
- Same hook for chat vs enrich if we add `agentKind` / `runId` fields later

---

## Upgrade semantic lint (phase 2)

The cleanup agent today does structural hygiene only. The organic-growth model needs a light semantic pass too, because chat-authored pages may contradict each other as evidence evolves.

Add a periodic **semantic lint mode** to the cleanup agent (not every turn — weekly or on manual request):

- Read recently-modified pages and check for internal contradictions (e.g. two people pages claim the same role)
- For pages with dated evidence notes, flag if the date is more than N months old and a fresher search might change the answer
- Identify topics queried frequently in chat (from structured telemetry or wiki scans) that still lack a wiki page — surface as suggestions, not auto-creates

This does not require email re-reads in the default pass; it's a read-only vault scan that matches page metadata patterns.

---

## What to measure

The experiment runs on a branch. Before merging, validate against these questions:


| Metric                              | How to measure                                                          | Target                                                        |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Onboarding token cost**           | Token logs at onboarding completion                                     | <10K tokens (identity only); current: 100K–500K               |
| **Time to first real answer**       | Session start → first substantive response                              | Under 5 minutes including IMAP sync                           |
| **Wiki page count growth curve**    | `pageCount` in `your-wiki.json` over time                               | 10–30 pages per 50 chat turns; no cold-start spike            |
| **Wiki hit rate**                   | `find`/`grep`/`read` calls in chat: did the turn read wiki before mail? | >40% of entity questions answered wiki-first after 30 days    |
| **Token cost per chat question**    | `usageLastInvocation` per turn; wiki-first vs mail-first                | Wiki-first turns cost <50% of mail-first equivalents          |
| **Answer quality on repeat topics** | Same question asked 2 weeks apart                                       | No factual regressions; ideally richer second answer          |
| **Supervisor idle rate**            | Laps between no-op states                                               | Supervisor reaches idle faster with less open-ended discovery |


The key comparison is not just cost but **value unlocked per token spent**. A wiki page created because the user asked a real question is more valuable than a page created speculatively by the supervisor.

---

## What the cleanup agent is already doing right

The existing maintenance setup (`yourWikiSupervisor.ts` + `wiki/cleanup.hbs`) is well-designed for the organic model:

- **Delta-anchored cleanup**: runs after every enrich lap and every chat turn (OPP-062), only on changed files — cheap and targeted.
- **Backoff logic**: goes idle after 3 no-op laps; wakes on mail sync. In the organic model this means the supervisor does very little when the user isn't chatting — correct behavior.
- **Post-chat touch-up**: already handles link hygiene immediately after the chat agent writes pages.

These don't need to change. The experiment is about **what drives page creation** (chat-triggered synthesis rather than background batch discovery), not about the maintenance infrastructure.

---

## Implementation plan

### Milestone A — WikiBuilder / enrich rescope (not arbitrary whole-wiki buildout)

- **Eligibility:** Prefer work items from **recent `wiki-edits.jsonl` paths**, **`## Chat capture`**, “new since last lap,” or **thin-page** heuristics—**not** greenfield discovery across all mail for every lap.
- **Behavior:** Same stack as today’s enrich (`wikiBuildoutAgent` / `wikiExpansionRunner`): mail search + read + **`write`/`edit`**, template-aware expansion, refresh stale claims where mail contradicts.
- **Telemetry / caps:** Reuse `BackgroundRunDoc`; explicit budgets per lap (max pages touched, max searches).
- **Concurrency:** Same-path editing policy if chat and enrich overlap (document single-flight or merge).

### Milestone B — Tool logging + enrich consumption

- **Already shipped:** wiki tools append to **`wiki-edits.jsonl`** on each mutation.
- **Next:** inject tail of **`wiki-edits.jsonl`** (or path list) into WikiBuilder / enrich prompts; optional schema fields (`agentKind`, `runId`) for chat vs enrich vs lint; migrate **`GET /api/wiki/log`** UI to the structured log when ready.
- **Do not** automate or prompt LLM edits to markdown **`_log.md`**.

### Milestone C — Onboarding + product experiment (still valid)

- Simplified onboarding when batch buildout is demoted; lower corpus gate experiments, etc. (see § Onboarding simplification).

### Milestone D — Evaluate

- Compare **before/after** enrich rescope: quality of `people/*` after WikiBuilder pass vs chat-only narrow page; cost per lap; fewer orphan speculative pages.

**Deprecated (superseded by Milestone A above):** Milestones “async wiki author job / handoff from main assistant” as the **primary** strategy—main assistant no longer drives that; **WikiBuilder** owns depth from logged signals.

---

## Business model alignment

This experiment directly addresses the cold-start economics problem:


| Model                            | Onboarding LLM cost        | Time to first value                          | Wiki useful by      |
| -------------------------------- | -------------------------- | -------------------------------------------- | ------------------- |
| **Current (batch buildout)**     | 100K–500K tokens           | After buildout completes (20–60 min)         | Onboarding complete |
| **Chat-first (this experiment)** | ~5K tokens (identity only) | Immediately (ripmail + chat from question 1) | ~20–30 chat turns   |


In the chat-first model, a new user gets a useful answer on question 1 (ripmail + chat), and the wiki starts feeling useful around question 10–20 (entities they've asked about before). They never wait for a buildout. The wiki is an enhancement they notice compounding naturally rather than a progress bar they wait for.

At gpt-5.4-mini pricing, the identity-only onboarding costs cents. The open question is whether the wiki grows fast enough through use to offset the loss of pre-built coverage — and that's exactly what the branch experiment measures.

---

## What this is not

- **Not a removal of the supervisor.** The enrich → cleanup loop remains; it just has less to do in the first days and kicks in more meaningfully once chat-authored pages need maintenance.
- **Not a promise the wiki won't need rebuilding.** If the user rarely chats about the same topic twice, the wiki stays sparse. The experiment tests whether real usage patterns generate enough repetition for organic compounding to work.
- **Not a change to the semantic accuracy bar.** Chat-authored pages follow the same quality rules: synthesize, don't paste email text; recency wins for current-state facts; short paragraphs and bullets.
- **Not a merge without data.** The core direction shipped (2026-04-30) after eval validation: 24/25 Enron cases pass with zero regressions on the original 23 tasks; WikiBuilder read/grep/find tools confirmed working. Remaining open items are tracked in OPP-067 and OPP-065.

---

## Open questions

1. **WikiBuilder queue:** Exact eligibility (log-only vs thin-page detector vs both); max pages per lap.
2. **Notification UX:** How does the user know an enrich pass finished?
3. **Corpus gate size:** Minimum message count for confident first `me.md` if onboarding slim-down ships.
4. **Minimum wiki for felt value:** How many pages before the user notices compounding?
5. **Chat question distribution:** Enough repetition for amortized synthesis?
6. **Model tier for enrich:** Same model as chat vs cheaper/smaller for merge-only vs stronger for hub synthesis.
7. **When to allow broader discovery:** Only after N chat turns / N logged paths?
8. **`wiki-edits.jsonl` at scale:** rotation, cap, or compaction policy for very large vaults.

---

## Success criteria

- **WikiBuilder rescope:** Enrich laps prefer **logged / thin / chat-originated** pages; speculative whole-inbox page creation is **not** the default loop.
- **Quality:** After enrich, benchmark `people/*` / `projects/*` read as **hubs** (optional [OPP-065](./OPP-065-wiki-eval-llm-as-judge.md) judge); chat-only narrow pages acceptable as **input** to enrich.
- **Trust:** User-visible or opt-in policy for background wiki writes.
- **Onboarding LLM cost** (when onboarding slim-down ships) drops vs full batch buildout model.
- **Time to first useful chat answer** unchanged or better.
- After sustained use, >40% of entity questions are answered wiki-first where a page exists.
- **`wiki-edits.jsonl`** reliably records agent wiki mutations; enrich loop can consume it (tail or injected excerpt).

---

## Related

- [OPP-033](./OPP-033-wiki-compounding-karpathy-alignment.md) — Your Wiki supervisor and Karpathy alignment umbrella; this OPP is an alternative *ingest path*, not a replacement for maintenance.
- [OPP-054](./OPP-054-guided-onboarding-agent.md) — Guided onboarding agent; the five-phase interview is simplified by this experiment.
- [OPP-062](./OPP-062-post-turn-wiki-touch-up-agent.md) — Post-turn touch-up (already shipped); works with the organic model unchanged.
- [the-wiki-question.md](../the-wiki-question.md) — The open product question this experiment is designed to answer empirically.
- [karpathy-llm-wiki-post.md](../karpathy-llm-wiki-post.md) — Original framing; "file good answers back into the wiki" is the core operation here.
- [OPP-065](./OPP-065-wiki-eval-llm-as-judge.md) — LLM-as-judge wiki eval; useful for measuring answer quality pre/post experiment.
- [OPP-035](./OPP-035-intent-based-skill-auto-loading.md) — `load_skill`; optional `**wiki-add` / `wiki-tidy`** split for tuned authoring vs maintenance playbooks.

