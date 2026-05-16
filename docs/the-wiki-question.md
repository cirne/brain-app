# The wiki question

**Status:** Open product question — not a decision document. **Product direction (2026-04-30):** Core **chat-first / organic growth** mechanics shipped in `main` ([archived OPP-066](./opportunities/archive/OPP-066-chat-first-wiki-organic-growth-experiment.md)): narrow chat capture + `## Chat capture`, `wiki-edits.jsonl`, WikiBuilder inspect-and-deepen tooling, identity-focused onboarding. Empirical closure on “is the wiki worth it?” still depends on **usage-scale evals** and **background deepen** queue work ([archived OPP-067](./opportunities/archive/OPP-067-wiki-buildout-agent-no-new-pages.md), [wiki-and-agent-evaluation.md](./wiki-and-agent-evaluation.md)).

**Related:** [VISION.md](./VISION.md), [karpathy-llm-wiki-post.md](./karpathy-llm-wiki-post.md), [architecture/wiki-read-vs-read-email.md](./architecture/wiki-read-vs-read-email.md), [product/personal-wiki.md](./product/personal-wiki.md), [wiki-and-agent-evaluation.md](./wiki-and-agent-evaluation.md) (eval gap: wiki + agent quality), [OPP-066](./opportunities/archive/OPP-066-chat-first-wiki-organic-growth-experiment.md), [OPP-062](./opportunities/archive/OPP-062-post-turn-wiki-touch-up-agent.md) (retired), [OPP-033](./opportunities/OPP-033-wiki-compounding-karpathy-alignment.md), [OPP-015](./opportunities/archive/OPP-015-wiki-background-maintenance-agents.md)

---

## Why this document exists

Braintunnel’s vision pairs **ripmail** (indexed email and files — rich, messy, authoritative *evidence*) with a **personal wiki** (linked markdown — synthesized, navigable *memory*). The assistant is designed to use **both**: tools for the index (`search_index`, `read_mail_message`, `read_indexed_file`, …) and tools for the vault (`read`, `grep`, … on the wiki tree).

In early development we often run with **very small wikis** (on the order of 10–20 pages) to iterate cheaply on onboarding and flows. At that scale it is **not obvious** that the wiki is doing unique work: a capable model with strong access to ripmail might **re-synthesize** answers on demand and look “good enough,” while the wiki adds **product and UX surface area** (what is my wiki, when do I create a page, what does “expanding the wiki” mean, who owns truth between mail and markdown).

This note poses the question **from first principles**: what is the wiki *for*, how would we know it is succeeding, and when does the cost of building and maintaining it outweigh the alternative of **compute-heavy, mail-grounded answers with no persistent synthesis layer**?

---

## What the vision already claims

From [VISION.md](./VISION.md):

- The assistant should feel like a **second brain**: personalization compounds as the wiki fills in.
- **Karpathy-style** framing: value is not only in individual notes but in the **network** of connections over time, and in a **single place** to put things so they are not lost.
- **ripmail** is the “richest personal data source” for many people; the wiki plus queryable mail is the raw material for a **genuinely personalized** assistant.
- Short-term proof includes: chat grounded in real data, **wiki grows through use**, email is queryable.

The architecture doc [wiki-read-vs-read-email.md](./architecture/wiki-read-vs-read-email.md) states the split explicitly:

- Wiki = **edited, cross-linked synthesized** knowledge (“working source of truth for digested information”).
- ripmail index = **evidence** (messages, attachments, paths) used to *inform* wiki pages — analogous to “read this email,” not “this file is the wiki.”

So **in product language**: the wiki is the **stabilized, structured layer**; ripmail is the **audit trail and raw corpus**. They are intentionally different *kinds* of truth (synthesis vs primary records).

**Reliability rule:** wiki synthesis is only as trustworthy as its evidence reconciliation. A wiki hit should orient the assistant, not end the investigation when a question depends on raw facts. If mail sources conflict, **recency is the default conflict resolver** for current-state facts: the latest relevant dated thread/message normally represents the present state; older messages are historical context. This is especially important for high-stakes domains like travel, deadlines, commitments, and scheduling, where one stale departure time or meeting detail can destroy user trust.

---

## Karpathy’s pattern (first principles)

Andrej Karpathy’s idea file **[LLM Wiki](./karpathy-llm-wiki-post.md)** ([original gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)) is the clearest statement of *why* a persistent wiki sits between the user and raw sources. Paraphrasing the core claims:

1. **RAG-style retrieval** from a pile of files means the model **rediscovers** knowledge on every question — there is **no accumulation**. Subtle questions that require combining many documents force repeated fragment-finding and stitching.
2. The alternative: the LLM **incrementally builds and maintains a persistent wiki** — structured, interlinked markdown **between** you and raw sources. New sources are **integrated**: entity pages updated, topic summaries revised, **contradictions** noted, synthesis **kept current**. Knowledge is **compiled** and then maintained, not re-derived from scratch on every query.
3. The wiki is a **persistent, compounding artifact**: cross-references already exist, contradictions already flagged, synthesis already reflects what you’ve ingested. Karpathy’s line: **“Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase.”**
4. **Operations** matter: ingest (integrate sources into many pages), query (read wiki + synthesize, optionally **file good answers back** into the wiki), **lint** (health-check for contradictions, stale claims, orphans, gaps).
5. **Why it works** (his view): humans abandon wikis because **bookkeeping** (cross-refs, consistency, updating summaries when new data arrives) grows faster than value. LLMs can touch many files in one pass; the human curates sources and direction.

So in Karpathy’s design, the wiki is **not** primarily “token optimization” as a hack — it is **amortized synthesis**: work done once (and on update), with **structure and consistency** that retrieval-only systems do not accumulate. Token savings can be a **consequence** of reading a small set of curated pages instead of re-scanning a large raw corpus every time, but the **deeper** claim is **compounding structure** and **explicit maintenance workflows** (ingest / query / lint).

**Important mismatch to name:** his writeup assumes the human rarely writes the wiki by hand; the LLM owns the wiki layer. Braintunnel’s product today mixes **user-visible files**, **assistant-authored edits**, and **future** automatic scaffolding. That hybrid can be **stronger** (human ground truth + automation) or **weaker** (unclear ownership, confusing UX) depending on execution.

---

## What we might mean by “value of the wiki”

Below are **distinct** hypotheses. They overlap in practice but failing one while succeeding another changes the product story.


| Hypothesis                                  | Rough claim                                                                                                                                           | How you’d notice if it’s wrong                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Amortized synthesis**                  | Repeated questions and multi-step reasoning get **better, faster answers** from stable pages + links than from re-deriving from mail each time.       | User tests: same tasks with wiki stripped to empty/minimal vs rich wiki; no quality/latency win from wiki.                                                         |
| **B. Consistency & contradiction handling** | The wiki holds **resolved** narrative (who is who, what project status is) and **explicit** conflict notes; mail alone stays noisy and contradictory. | Assistant often contradicts earlier answers; wiki pages drift from mail with no reconciliation story.                                                              |
| **C. Token / context efficiency**           | Answering from a compact, on-topic set of wiki pages uses less context than assembling from many threads.                                             | Marginal API cost or quality plateaus; tiny wiki in dev never stresses context.                                                                                    |
| **D. User-legible memory**                  | The vault is **inspectable** — users trust Braintunnel because they can **see** what it “believes.”                                                   | Users never open wiki; trust is identical with wiki hidden.                                                                                                        |
| **E. Provenance & control**                 | Wiki is where **preferences and commitments** live (“always do X”) distinct from **evidence** in mail.                                                | Everything could live as structured memory without markdown; see [architecture/wiki-vs-managed-memory-honcho.md](./architecture/wiki-vs-managed-memory-honcho.md). |


Karpathy’s gist stresses **A**, **B**, and the **lint** loop; **C** is secondary; **D/E** depend on product choices Braintunnel has not fully settled.

---

## The ripmail-only counterfactual

A reasonable challenge:

> If the assistant always has `search_index` plus **`read_mail_message` / `read_indexed_file`** (and enough turns), **maybe** it can answer as well as wiki+ripmail by **reading threads on the fly**, and the wiki is redundant except as a **cache** we pay human and engineering cost to maintain.

**Arguments for the counterfactual**

- Mail is **ground truth** for “what actually happened.”
- Small wikis **under-test** the “network effect” premise from [VISION.md](./VISION.md).
- Automatic wiki upkeep is **hard**; wrong wiki pages may be **worse** than no wiki.

**Arguments against relying on ripmail alone**

- **Repeated synthesis is expensive** in tokens, latency, and failure modes (missed threads, wrong merge).
- **Cross-thread concepts** (“who is this person across years,” “what is the arc of this project”) are exactly what a maintained graph of pages is for — if the wiki is doing its job.
- **Contradictions and drift** across time are easier to **surface in a maintained layer** (Karpathy’s lint + entity pages) than to infer reliably ad hoc.
- **User intent and compression**: some facts are not in any single email (preferences, decisions, “this is how I want work described”).

None of these “against” points **prove** Braintunnel’s current wiki UX is worth it; they say **when** a compounding layer wins — at **scale** (many sources, many pages, repeated queries), with **good maintenance**, and with **clear ownership** between evidence and synthesis.

---

## UX cognitive load (why this hurts before value is proven)

Until the wiki is **obviously** helping, users still face:

- **What is “my wiki”?** Is it my notes, the assistant’s notes, or both?
- **When should I create or edit a file** vs ask in chat vs rely on mail?
- **What is “expanding the wiki”?** Is it automatic, approval-based, or manual? How does it relate to indexing mail?
- **What is canonical?** If a wiki page and a thread disagree, which wins? Current product rule: wiki is synthesized working memory, mail is evidence, and the newest relevant dated source normally wins for current-state facts.

[product/personal-wiki.md](./product/personal-wiki.md) already aims to reduce this (“wiki is not the product for its own sake — it is memory and structure”). The open issue is: **until** maintenance and scaffolding are strong, **marketing clarity cannot fully substitute** for **felt benefit**.

---

## Automated maintenance: when is the wiki “good enough”?

[OPP-015](./opportunities/archive/OPP-015-wiki-background-maintenance-agents.md) sketches background agents that lint, scaffold, and suggest — with **success criteria** like: broken links and orphans improve **without** user micromanagement.

That leaves **strategic** questions unanswered:

1. **Good enough for what?** User trust? Answer quality vs ripmail-only? Frequency of contradiction between wiki and index?
2. **Ground truth checks:** Should maintenance agents **diff** wiki claims against indexed sources (sampled or on schedule)? What’s the false-positive cost?
3. **Human-in-the-loop:** Karpathy prefers **involved** ingest; Braintunnel may want **suggest → review** for high-stakes pages. What’s the default policy?
4. **Metrics:** Link health is measurable; **semantic accuracy** and **staleness vs mail** are harder — do we need periodic **probe questions** (eval harness) with and without wiki enabled?

Until these are defined, “the maintenance agent will fix it” is a **hope**, not a **closure condition**.

---

## Product state and what we are still measuring

**Current state (after OPP-066 core ship, 2026-04-30):**

- Vision and architecture still **commit to** wiki + ripmail + assistant tools.
- **Chat** is tuned for **narrow capture** while answering (question-scoped writes, provenance stub for downstream deepen) — not for finishing full person/project hubs in one turn; **WikiBuilder** is intended to **deepen** pages already touched (with `read` / `grep` / `find` before writing) using signals like the tail of **`wiki-edits.jsonl`**.
- **Onboarding** is **identity-first** (~2–3 min); “important people” and other buildout-oriented phases are **removed** so entities enter the wiki through **real questions** rather than a long interview.
- **Maintenance stack:** **Your Wiki** supervisor **enrich → cleanup** on each lap — **[architecture/your-wiki-background-pipeline.md](./architecture/your-wiki-background-pipeline.md)** ([OPP-033](./opportunities/OPP-033-wiki-compounding-karpathy-alignment.md) product framing); chat-authored paths in **`wiki-edits.jsonl`** — **planned:** fold recent log paths into cleanup anchors ([OPP-033](./opportunities/OPP-033-wiki-compounding-karpathy-alignment.md#lint-inputs-and-cadence-2026)).
- **Local/dev wikis can stay small**, which still **under-samples** network and lint effects — the open question is whether **organic growth from chat** reaches **felt compounding** fast enough vs batch buildout.

**Still the empirical experiment (not closed):**

1. At **personal scale** (tens→hundreds of pages, meaningful link graph), does **wiki + ripmail** beat **ripmail-only** on repeat entity questions — **quality**, **latency**, **tokens** — with the new capture/deepen split?
2. Run comparable **task batteries** with: (a) ripmail tools only, (b) wiki + ripmail, (c) wiki minimized or stripped; use anchored historical evals where needed (`EVAL_ASSISTANT_NOW` / `resolveEvalAnchoredNow` per OPP-066).
3. Add **wiki quality** scoring beyond regression harnesses — [OPP-065](./opportunities/OPP-065-wiki-eval-llm-as-judge.md) — and wire **WikiBuilder** eligibility to **logged paths** without speculative whole-inbox page farms — [archived OPP-067](./opportunities/archive/OPP-067-wiki-buildout-agent-no-new-pages.md).
4. Optionally track **contradiction rate** between wiki answers and thread evidence for the same queries.

That still tests whether the hoped-for benefit is **real at scale** or **illusory at small scale**, and how much to invest in **wiki UX** vs **ripmail quality** vs **automatic maintenance** under the shipped ingest model.

---

## Open questions (summary)

1. **Primary value:** Is Braintunnel’s wiki mainly **amortized synthesis** (Karpathy), **inspectable memory**, **token efficiency**, or **something else** — and in what ratio?
2. **Small-wiki trap:** Are we drawing conclusions from wikis too small to exhibit **network** and **lint** effects?
3. **Ripmail-only parity:** Under what query distributions does **on-the-fly** mail reasoning match wiki-assisted reasoning — and where does it **break** (long horizons, many threads, preference-heavy tasks)?
4. **Ownership:** If the wiki is mostly **machine-maintained**, how do we explain **user edits** and **conflicts** with mail?
5. **Closure:** What **measurable** conditions mean “wiki maintenance succeeded” — link health only, or **semantic** alignment with sources?
6. **Cost tradeoff:** If maintenance is imperfect, does a **stale wiki** hurt more than **no wiki**?

---

## References

- Karpathy, **LLM Wiki**: [karpathy-llm-wiki-post.md](./karpathy-llm-wiki-post.md) (full text); [original gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)  
- Internal: [VISION.md](./VISION.md), [wiki-read-vs-read-email.md](./architecture/wiki-read-vs-read-email.md), [wiki-and-agent-evaluation.md](./wiki-and-agent-evaluation.md), [OPP-066](./opportunities/archive/OPP-066-chat-first-wiki-organic-growth-experiment.md), [OPP-015](./opportunities/archive/OPP-015-wiki-background-maintenance-agents.md)
- Roadmap umbrella: [OPP-033: Wiki compounding + Karpathy alignment](./opportunities/OPP-033-wiki-compounding-karpathy-alignment.md); concrete defect: [BUG-011](./bugs/BUG-011-wiki-expansion-missing-me-md-context.md)

---

*This document is meant to sharpen the question for roadmap and eval design — not to prescribe an answer.*