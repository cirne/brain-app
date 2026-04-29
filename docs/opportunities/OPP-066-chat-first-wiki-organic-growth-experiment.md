# OPP-066: Chat-first wiki — organic growth experiment

**Status:** Proposal — branch experiment before merging to main  
**Branch:** `exp/chat-first-wiki`  
**Related:** [OPP-033](./OPP-033-wiki-compounding-karpathy-alignment.md), [OPP-054](./OPP-054-guided-onboarding-agent.md), [OPP-062](./OPP-062-post-turn-wiki-touch-up-agent.md), [the-wiki-question.md](../the-wiki-question.md), [karpathy-llm-wiki-post.md](../karpathy-llm-wiki-post.md)

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
- Append a chronological `log.md` of what has been built and when

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

| Phase | Why it exists today | Chat-first model |
|---|---|---|
| **Confirm identity** | Write accurate `me.md` | Still needed — `me.md` is the assistant context |
| **Name the assistant** | Write `assistant.md` | Still useful, same exchange as identity |
| **Calendar setup** | Remove noise before buildout reads calendar | Deferred — "hide my shared calendars" in chat |
| **Inbox rules** | Reduce noise in buildout's email reads | Deferred — `/inbox` or main chat on demand |
| **Important people** | Guide the buildout toward the right entities | **Eliminated** — wiki discovers them through use |

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

Strengthen the wiki-writing directive in `src/server/prompts/assistant/base.hbs` from a loose suggestion to a **systematic synthesis rule**:

- **After any turn requiring 2+ email reads about a named entity** (person, project, org, topic), write or update a wiki page for that entity — even if the page is short. The synthesis cost was already paid answering the question; persisting it is nearly free.
- **Before querying email for a named entity**, check if a wiki page already exists. If it does, start there and supplement with targeted email lookups only for recency or missing facts.

The existing prompt already says "wiki first, then mail" and "write when you learn something durable." The change is making *when* to write explicit and mechanical rather than discretionary.

---

## Add `wiki/log.md`

Karpathy's spec calls out `log.md` as essential infrastructure: an append-only, chronological record of what was ingested, queried, and linted, parseable with simple tools.

Add `log.md` to the starter wiki scaffold and have both the chat agent and the supervisor append entries:

```
## [YYYY-MM-DD] chat | people/jane-doe.md — synthesized from 3 email threads
## [YYYY-MM-DD] chat | projects/acme-launch.md — created
## [YYYY-MM-DD] supervisor-enrich | lap 3 — 2 pages updated
## [YYYY-MM-DD] supervisor-lint | cleaned 1 broken link, 0 orphans
```

Benefits:
- The agent on subsequent laps knows what was built and when (avoids redundant re-synthesis)
- Cheap to write: an `edit` append to `log.md` after each create adds ~50 tokens
- Makes wiki evolution visible to the user — they can open `log.md` and see the history
- Enables semantic lint to identify topics queried frequently (via log) that still lack pages

---

## Upgrade semantic lint (phase 2)

The cleanup agent today does structural hygiene only. The organic-growth model needs a light semantic pass too, because chat-authored pages may contradict each other as evidence evolves.

Add a periodic **semantic lint mode** to the cleanup agent (not every turn — weekly or on manual request):
- Read recently-modified pages and check for internal contradictions (e.g. two people pages claim the same role)
- For pages with dated evidence notes, flag if the date is more than N months old and a fresher search might change the answer
- Identify topics queried frequently in chat (via `log.md`) that still lack a wiki page — surface as suggestions, not auto-creates

This does not require email re-reads in the default pass; it's a read-only vault scan that matches page metadata patterns.

---

## What to measure

The experiment runs on a branch. Before merging, validate against these questions:

| Metric | How to measure | Target |
|---|---|---|
| **Onboarding token cost** | Token logs at onboarding completion | <10K tokens (identity only); current: 100K–500K |
| **Time to first real answer** | Session start → first substantive response | Under 5 minutes including IMAP sync |
| **Wiki page count growth curve** | `pageCount` in `your-wiki.json` over time | 10–30 pages per 50 chat turns; no cold-start spike |
| **Wiki hit rate** | `find`/`grep`/`read` calls in chat: did the turn read wiki before mail? | >40% of entity questions answered wiki-first after 30 days |
| **Token cost per chat question** | `usageLastInvocation` per turn; wiki-first vs mail-first | Wiki-first turns cost <50% of mail-first equivalents |
| **Answer quality on repeat topics** | Same question asked 2 weeks apart | No factual regressions; ideally richer second answer |
| **Supervisor idle rate** | Laps between no-op states | Supervisor reaches idle faster with less open-ended discovery |

The key comparison is not just cost but **value unlocked per token spent**. A wiki page created because the user asked a real question is more valuable than a page created speculatively by the supervisor.

---

## What the cleanup agent is already doing right

The existing maintenance setup (`yourWikiSupervisor.ts` + `wiki/cleanup.hbs`) is well-designed for the organic model:

- **Delta-anchored cleanup**: runs after every enrich lap and every chat turn (OPP-062), only on changed files — cheap and targeted.
- **Backoff logic**: goes idle after 3 no-op laps; wakes on mail sync. In the organic model this means the supervisor does very little when the user isn't chatting — correct behavior.
- **Post-chat touch-up**: already handles link hygiene immediately after the chat agent writes pages.

These don't need to change. The experiment is about **what drives page creation** (chat-triggered synthesis rather than background batch discovery), not about the maintenance infrastructure.

---

## Implementation plan (branch `exp/chat-first-wiki`)

### Step 1 — Simplify onboarding

- Reduce the onboarding agent's scope to identity confirmation + `me.md` + `assistant.md` only.
- Remove the "important people" phase from `src/server/prompts/onboarding-agent/system.hbs`.
- Remove or defer the calendar and inbox rules phases.
- Lower the corpus gate threshold from ~200 messages to ~10–50 (enough for a name/bio guess).
- Do not trigger a wiki buildout after `finish_conversation`. The supervisor starts in background at normal priority.

### Step 2 — Strengthen the chat agent's wiki-writing rule

Edit `src/server/prompts/assistant/base.hbs`:

- Replace the loose "write when you learn something durable" guidance with explicit mechanics: after any turn that required multiple email reads about a named entity, write or update a wiki page with the synthesis.
- Add: before querying email about a named entity, check for an existing wiki page and use it as the starting point.
- Add: append a one-line entry to `log.md` when creating a new page.

### Step 3 — Add `log.md` to the starter scaffold

- Add `wiki/log.md` to `assets/starter-wiki/` with a brief header comment.
- Add a short append-to-log instruction to the chat system prompt.
- Extend the cleanup agent's orphan pass to verify `log.md` exists.

### Step 4 — Instrumentation

- Add a `wikiHitRate` counter to chat turn telemetry: did the turn call `find`/`grep`/`read` before `search_index`?
- Track `pagesCreatedByChat` vs `pagesCreatedBySupervisor` in the `your-wiki.json` doc.
- Export `log.md` line count as a cheap proxy for wiki activity over time.

### Step 5 — Evaluate and decide

Run the branch for 2–4 weeks of real usage. Compare against the `main` buildout model on onboarding cost, wiki growth rate, and repeat-question quality. If the organic model performs comparably or better at lower cost, merge to main. If the wiki stays too sparse, diagnose: is the chat agent's writing rate too low (prompt issue) or is the question distribution too one-off (product issue)?

---

## Business model alignment

This experiment directly addresses the cold-start economics problem:

| Model | Onboarding LLM cost | Time to first value | Wiki useful by |
|---|---|---|---|
| **Current (batch buildout)** | 100K–500K tokens | After buildout completes (20–60 min) | Onboarding complete |
| **Chat-first (this experiment)** | ~5K tokens (identity only) | Immediately (ripmail + chat from question 1) | ~20–30 chat turns |

In the chat-first model, a new user gets a useful answer on question 1 (ripmail + chat), and the wiki starts feeling useful around question 10–20 (entities they've asked about before). They never wait for a buildout. The wiki is an enhancement they notice compounding naturally rather than a progress bar they wait for.

At gpt-5.4-mini pricing, the identity-only onboarding costs cents. The open question is whether the wiki grows fast enough through use to offset the loss of pre-built coverage — and that's exactly what the branch experiment measures.

---

## What this is not

- **Not a removal of the supervisor.** The enrich → cleanup loop remains; it just has less to do in the first days and kicks in more meaningfully once chat-authored pages need maintenance.
- **Not a promise the wiki won't need rebuilding.** If the user rarely chats about the same topic twice, the wiki stays sparse. The experiment tests whether real usage patterns generate enough repetition for organic compounding to work.
- **Not a change to the semantic accuracy bar.** Chat-authored pages follow the same quality rules: synthesize, don't paste email text; recency wins for current-state facts; short paragraphs and bullets.
- **Not a merge without data.** The branch lives as an experiment until numbers say it works.

---

## Open questions

1. **Corpus gate size:** What is the minimum message count to write a confident first `me.md`? Current gate is ~200; this model could drop to 10–50. Test with the onboarding eval harness.
2. **Minimum wiki for felt value:** How many pages need to exist before the user consciously notices the wiki helping? 10? 30? 50? This sets the threshold for "organic growth is working."
3. **Chat question distribution:** Do users ask about the same person/topic enough times for meaningful coverage to build up? Or are questions one-off? Log.md + hit-rate telemetry answers this.
4. **Prompt tightness:** How explicit does the chat agent directive need to be for gpt-5.4-mini to reliably write wiki pages after email lookups? Test with the Enron eval harness.
5. **When to re-enable open-ended supervisor laps:** A reasonable policy: supervisor runs open-ended laps only after the user has had 30+ chat turns, at which point organic coverage exists to anchor on.
6. **log.md cost at scale:** A log entry per page creation adds ~50 tokens. Not significant in isolation; worth confirming it doesn't compound over thousands of entries.

---

## Success criteria

- **Onboarding LLM cost** drops by >90% vs current buildout model (measurable from token logs on the branch).
- **Time to first useful chat answer** is unchanged or better — ripmail available from question 1.
- **Corpus gate** successfully lowered without producing wrong `me.md` (test with eval fixtures).
- After 30 chat turns, >40% of entity questions are answered wiki-first without new email queries.
- `log.md` exists and is readable in all test vaults; no broken entries from the chat agent.
- Branch experiment reviewed, numbers shared, and a go/no-go decision made before any merge to main.

---

## Related

- [OPP-033](./OPP-033-wiki-compounding-karpathy-alignment.md) — Your Wiki supervisor and Karpathy alignment umbrella; this OPP is an alternative *ingest path*, not a replacement for maintenance.
- [OPP-054](./OPP-054-guided-onboarding-agent.md) — Guided onboarding agent; the five-phase interview is simplified by this experiment.
- [OPP-062](./OPP-062-post-turn-wiki-touch-up-agent.md) — Post-turn touch-up (already shipped); works with the organic model unchanged.
- [the-wiki-question.md](../the-wiki-question.md) — The open product question this experiment is designed to answer empirically.
- [karpathy-llm-wiki-post.md](../karpathy-llm-wiki-post.md) — Original framing; "file good answers back into the wiki" is the core operation here.
- [OPP-065](./OPP-065-wiki-eval-llm-as-judge.md) — LLM-as-judge wiki eval; useful for measuring answer quality pre/post experiment.
