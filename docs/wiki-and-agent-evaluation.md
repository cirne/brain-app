# Wiki and agent evaluation (open problem)

**Status:** Open — **critical to-do** (research and tooling; not a product opportunity ticket). **Update (2026-04-30):** Pieces that help measurement landed with [archived OPP-066](./opportunities/archive/OPP-066-chat-first-wiki-organic-growth-experiment.md) (shipped; epic **closed** for backlog tracking): **eval clock anchoring** (`EVAL_ASSISTANT_NOW` / `resolveEvalAnchoredNow`) for historical-corpus runs, and **structured wiki mutation logging** via `var/wiki-edits.jsonl` (server-side rows per agent `write` / `edit` / `move_file` / `delete_file`) so “what changed” is ordered and machine-consumable. A **minimal task harness** (e.g. Enron-case regression checks cited in OPP-066) exists before a full wiki-quality ontology does. **Still open:** systematic wiki-property scoring and CI-shaped suites — see [OPP-065](./opportunities/OPP-065-wiki-eval-llm-as-judge.md); **WikiBuilder** queue from the log tail — [OPP-067](./opportunities/OPP-067-wiki-buildout-agent-no-new-pages.md).

**Related:** [the-wiki-question.md](./the-wiki-question.md), [VISION.md](./VISION.md), [architecture/agent-chat.md](./architecture/agent-chat.md), [OPP-033](./opportunities/OPP-033-wiki-compounding-karpathy-alignment.md), [OPP-066](./opportunities/archive/OPP-066-chat-first-wiki-organic-growth-experiment.md), [OPP-065](./opportunities/OPP-065-wiki-eval-llm-as-judge.md), [OPP-067](./opportunities/OPP-067-wiki-buildout-agent-no-new-pages.md), [OPP-072 (token metering)](./opportunities/OPP-072-llm-usage-token-metering.md)

---

## Why this document exists

We do **not** yet have a **complete eval suite** for Braintunnel’s knowledge loop: **mail and files → wiki** and **wiki + tools → answers**. Targeted harnesses and telemetry hooks are landing (see status above); a **durable** suite across wiki quality dimensions, models, and CI is still missing. Without that, it remains hard to justify broad iteration, compare models, or know whether the wiki and the agent are improving end to end.

This note captures the **problem** (what we need to learn and measure) and frames **two separable concerns**. It is intentionally **not** filed as an opportunity: it is a **foundational research and engineering** gap. Follow-on work may spin out as OPPs, benchmarks, or CI jobs once the measurement story is clearer.

---

## 1. Wiki quality: what are we even scoring?

**Inputs** might include: a fixed corpus of **emails** (or threads), and summary stats such as **terms** and **tokens** in the generated or evolved wiki.

**The hard part** is the **subjective** quality of that wiki: coverage, accuracy, link utility, whether pages **compound** (Karpathy-style, see [karpathy-llm-wiki-post.md](./karpathy-llm-wiki-post.md)) vs duplicate mail, and whether maintenance agents improve or erode trust. It is not obvious how to **codify** “good wiki” in a way that is **stable, comparable across runs, and not just a proxy for model verbosity**.

**Open threads:**

- Distinguish **structural** signals (link graph health, orphan rate, title normalization) from **semantic** alignment with **ground truth** in mail (contradiction checks, spot audits, or LLM-judge on sampled claims).
- Accept that some dimensions may stay **human-in-the-loop** for a long time, while we still build **reproducible harnesses** (fixed corpora, fixed prompts, frozen judge prompts).
- **Next step:** deliberate **research** time and **discussion with a strong model** (and humans) on how to define **wiki quality** we care about, what can be automated, and what should remain manual review. Product tracking for **LLM-as-judge** and wiki property scores: [OPP-065](./opportunities/OPP-065-wiki-eval-llm-as-judge.md).

---

## 2. Agent quality: answers from the wiki and tools (separate from wiki-only scores)

The **downstream** product is the **agent**: it must **synthesize** answers using the **wiki**, **ripmail** (and other tools), and turn that into **useful, grounded replies**.

That deserves **its own** eval track:


| Dimension          | What to explore                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Answer quality** | Correctness, grounding in mail/wiki, abstention when evidence is thin, user-facing usefulness (judge or task success). |
| **Latency**        | Time to first token / full response under realistic tool-call patterns.                                                |
| **Tokens**         | Total tokens (and breakdown: system, tools, user) per successful task; cost proxies.                                   |
| **Model**          | Same battery **varied by model** — quality/latency/token tradeoffs are not portable.                                   |


**Ripmail and wiki are different failure modes:** the agent can be weak at retrieval, overconfident with a sparse wiki, or strong with mail but wasteful on tokens. Evals should **not** collapse “wiki good” and “agent good” into one number without design.

---

## 3. Critical to-do (summary)

1. **Build or adopt a complete eval suite** (datasets, tasks, scoring hooks, optional CI) for Brain — extending the **minimal harness + telemetry** now in flight (OPP-066) rather than restarting from zero.
2. **Wiki track:** research and define **measurable** (and explicitly subjective) **wiki quality** given mail + size/token constraints; align with [the-wiki-question.md](./the-wiki-question.md) and [OPP-033](./opportunities/OPP-033-wiki-compounding-karpathy-alignment.md); use **`wiki-edits.jsonl`** and enrich outcomes as **ordered before/after** signals where helpful.
3. **Agent track:** measure **end-to-end answer quality**, **latency**, and **token use**, with **per-model** matrices, including tool use (ripmail, wiki reads, etc.).

---

## Non-goals (for this note)

- Choosing a single LLM-judge as the only metric.
- Committing to a product roadmap; this is a **problem statement** and prioritization note.

---

*When this stabilizes, consider linking from architecture docs, splitting benchmarks into an OPP, or adding a `tests/evals/` (or similar) tree with a short README that points here.*
