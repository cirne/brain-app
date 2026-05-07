# Onboarding insight gallery — “delight tiles” from indexed mail

**Status:** Backlog — no OPP yet; product + agent UX; builds on existing onboarding and wiki bootstrap work  
**Index:** [IDEAS.md](../IDEAS.md)  
**Relates to:** [VISION.md](../VISION.md) (five-minute magic), [STRATEGY.md](../STRATEGY.md) (trust moat), [onboarding-state-machine.md](../architecture/onboarding-state-machine.md), [OPP-094](../opportunities/OPP-094-holistic-onboarding-background-task-orchestration.md), [OPP-095](../opportunities/OPP-095-wiki-first-draft-bootstrap.md), [OPP-054](../opportunities/OPP-054-guided-onboarding-agent.md)

---

## Problem

After Google (or Apple) mail connects, the index can grow to **hundreds or thousands of messages within minutes**. The product surface that greets the user is still largely **generic**: calendar, inbox list, docs — plus “ask anything” empty chat ([`ConversationEmptyState.svelte`](../../src/client/components/agent-conversation/ConversationEmptyState.svelte)), [`Home.svelte`](../../src/client/components/Home.svelte).

That undersells what **indexed personal mail** uniquely enables: cross-thread synthesis, obligation archaeology, trip stitching, subscription audits — work that generic assistants and vanilla inbox UIs do not do well.

At the same time, **freestyling** (“here is something surprising we found in your mail”) is dangerous for **trust**: unintended surfacing of sensitive merchants, health, legal, or adult-adjacent topics can embarrass or alarm users on first run.

We need a **deliberate early experience**: teachable, wow-worthy, **opt-in per insight**, and aligned with our **privacy posture** ([STRATEGY.md](../STRATEGY.md)).

---

## The idea

Ship a small **Insight Gallery**: a set of **tappable tiles** (chips or cards) on Home (or a first-run surface), each labeled with a **curated use case**.

- **Product defines categories** (what exists in the gallery).
- **User taps** to run one category — only then does the agent search/read mail and stream a structured answer.
- **LLM does synthesis** (the “felt” personalization: connecting dots, tone, narrative).
- **Optional “Surprise me”** still draws from the **same allowlisted tile set**, not open-ended corpus rummaging.

This is intentionally **hybrid**: neither pure heuristics (boring, brittle) nor pure LLM serendipity (uneven, risky).

**Composes with existing work:**

- **[OPP-095](../opportunities/OPP-095-wiki-first-draft-bootstrap.md)** can keep producing **background wiki skeleton** (`people/`, `projects/`, `travel/`, etc.).
- The gallery is a **foreground** “see what your mail implies” layer — same corpus, different UX. Tiles can deep-link into wiki stubs the bootstrap just wrote.

---

## v1 tile set (starter suggestions)

Group tiles so the gallery reads as a **story** about what the inbox knows. Exact labels are TBD; each tile implies a **bounded agent prompt** (tool plan: `search_index`, `read_mail_message`, optional calendar when wired).

**Money (category-bounded — no “all spending” firehose)**

- Subscriptions / recurring charges audit (and rough monthly burn).
- Free trials ending soon.
- Refunds, credits, or “money on the table” (airline credits, unredeemed gift cards) when mail supports it.
- Tax-relevant receipts (donations, clearly business) — **on tap only**; seasonal emphasis OK.

**Travel**

- Upcoming trips stitched from confirmations (flights, hotels, cars, activities) across threads and time.
- Loyalty / status nuggets when airlines or chains email you.

**People & obligations**

- **Replies you owe** — threads where someone asked you something and you have not answered (high utility, low embarrassment vs. shaming the user).
- People you have written who have not replied (secondary tile; more guilt-adjacent — softer copy).
- Top correspondents (visceral “it knows my network”).

**Knowledge you forgot**

- Recommendations buried in mail (books, restaurants, places).
- “Loose ends” — patterns like “you said you would send X / follow up by Y” (high value; copy must be non-judgmental).

**Briefing**

- Reuse or surface **[briefing](../../.cursor/skills/briefing/SKILL.md)** / **[morning-report](../../.cursor/skills/morning-report/SKILL.md)**-style flows as **discoverable tiles**, not only slash-invocations.

---

## Phase 2 — longer corpus (e.g. after ~6 months indexed or full backfill milestone)

These need **baseline history** to be meaningful; consider **gating** on `FULLY_SYNCED`-style milestones ([OPP-094](../opportunities/OPP-094-holistic-onboarding-background-task-orchestration.md)) or indexed depth.

- “What you were working on **six months ago**” (time machine — strong marquee).
- Dormant contacts you used to email often.
- Project arcs over quarters (rise/fall of a topic in sent mail).
- Year-in-review / decision archaeology (optional; heavier).

---

## Privacy, safety, and copy

1. **No auto-display of sensitive specifics** on shared surfaces (e.g. Home). At most **aggregate teaser**: “12 subscriptions · 5 open loops · 1 trip this week.”
2. **No unbounded “all purchases” tile.** Spending-shaped insights stay **category-scoped** so the model is not instructed to dump every merchant.
3. **Sensitive verticals** (adult retail, health billing, legal, financial distress, political donations, etc.) are never **headline** categories; if aggregated at all, use **non-specific** grouping (“other personal”) and only under explicit user paths, consistent with conservative wiki bootstrap rules ([OPP-095](../opportunities/OPP-095-wiki-first-draft-bootstrap.md) people heuristics).
4. **Default output is ephemeral** (chat session). **Pin to wiki** only on explicit user action — keeps brain-to-brain and sharing stories clean ([STRATEGY.md](../STRATEGY.md)).
5. **Eval gap:** Today’s mail evals skew toward **needle-in-haystack** retrieval (`eval/tasks/enron-v1.jsonl`). Add evals for **structured insight** tasks (subscription audit, trip stitching, open-loop detection) when implementation starts.

---

## UX placement (hypotheses)

- **Primary:** A **first-run strip** above existing Home cards (Today / Inbox / Docs), shown for a bounded window (e.g. first 24h after “enough” index, or until user dismisses).
- **Alternative:** Dedicated “Discover” or Hub subsection — trades discoverability for less visual noise.
- **Performance:** v1 likely **agent-on-tap** (fresh, truthful to current index). Optional later: **pre-warm** top 3 tiles after sync completes to reduce latency.

---

## Relationship to the guided interview

[OPP-054](../opportunities/OPP-054-guided-onboarding-agent.md) is **elicitation** (“tell me about you”).

The gallery is **demonstration** (“here is what becomes possible with your mail”).

**Sequencing hypothesis:** run interview first (short), then unlock or emphasize the gallery so the user sees **grounded** insights rather than cold suggestions.

---

## Open questions

1. **Gate:** Show gallery after interview `done`, after first **N** messages indexed, or as soon as FTS is warm? Trade-offs: quality of first answer vs. time-to-wow.
2. **Hosted vs desktop:** Same gallery everywhere, or reduced set without calendar?
3. **Cost:** Token budget per tile; rate limits; model tier for first-run users.
4. **Internationalization:** Merchant/subscription patterns differ by locale.
5. **Multi-mailbox:** How do tiles combine or separate accounts?
6. **Pre-compute vs on-demand:** When does background summarization (one job per tile) beat interactive chat?

---

## Next step toward shipping

When scoped enough, split into one or more **OPPs**, for example:

- Product + client: Home / empty-state integration, tile registry, telemetry (tap → completion).
- Agent: per-tile system prompts, tool budgets, structured output hints, safety rules.
- Eval: JSONL tasks for insight categories (beyond retrieval golden strings).

Until then, this file is the **design anchor** for “early delight without creepy surprises.”
