# Enron eval suite — architecture and operating model

**Status:** Proposal / living architecture (implementation follows existing harness in [`eval/README.md`](../../eval/README.md)).

**Purpose:** Define a **manageable** integration-eval practice on the **Enron demo corpora** so we can (1) measure assistant effectiveness on realistic mail+wiki tasks, (2) **detect regressions** when agent behavior changes, and (3) grow the suite in a **disciplined** way: each production failure or gap becomes a **new JSONL case**, fixes must **pass that case without breaking the rest**.

---

## 1. Goals and non-goals

### Goals

| Goal | What “good” looks like |
|------|-------------------------|
| **Regression safety net** | A fixed battery of tasks runs on a **seeded, production-shaped** `BRAIN_HOME`; failures are actionable (`failReasons`, traces, saved reports). |
| **Comparable runs** | Same task file, same corpus version, same clock anchoring (`EVAL_ASSISTANT_NOW` / harness defaults), documented concurrency (`EVAL_MAX_CONCURRENCY`). |
| **Authoring discipline** | Every new failure mode gets a **stable `id`**, expectations that are **cheap to maintain** (prefer stable substrings over brittle prose). |
| **Multi-persona readiness** | Tasks can target **Kean**, **Lay**, or **Skilling** tenants (see registry) by setting `BRAIN_HOME` / future task fields — not only the default Kean tree. |

### Non-goals (for this track)

- **Single number for “wiki quality”** — that stays a separate research thread; see [`docs/wiki-and-agent-evaluation.md`](../wiki-and-agent-evaluation.md) and OPP-065.
- **Replacing human review** for subjective synthesis — we use **substring / tool / ordering checks** first; optional LLM-judge is an additive layer, not the default gate.
- **Committing raw mail** — corpus stays in tarball + ignored tenant dirs; tasks reference **message ids and quoted fragments** that are stable after ingest.

---

## 2. What exists today (anchor the design)

### Harness

- **Task format:** `eval/tasks/enron-v1.jsonl` — one JSON object per line: `id`, `userMessage`, `expect` (composite `all` / `any` of clauses). Types live in [`src/server/evals/harness/types.ts`](../../src/server/evals/harness/types.ts).
- **Execution:** `runAgentEvalCase` ([`runAgentEvalCase.ts`](../../src/server/evals/harness/runAgentEvalCase.ts)) runs **one** `agent.prompt()` in an isolated session, then `checkExpect` against **`finalText`**, **`toolTextConcat`**, and **ordered `toolNames`**.
- **Metrics collection:** `collectAgentPromptMetrics` ([`collectAgentPromptMetrics.ts`](../../src/server/evals/harness/collectAgentPromptMetrics.ts)) already centralizes **wall time**, **usage**, **completion count**, **final assistant text**, **tool name order**, and **concatenated tool result bodies** (plus optional `EVAL_AGENT_TRACE=1` JSON lines).

### Corpora and tenants

Documented in [`docs/architecture/eval-home-and-mail-corpus.md`](./eval-home-and-mail-corpus.md) and [`eval/README.md`](../../eval/README.md):

- Default JSONL **`BRAIN_HOME`:** Kean → `./data/usr_enrondemo00000000001`.
- **Lay** and **Skilling** sibling tenants under `./data` for `/demo` and Playwright; eval tasks today are overwhelmingly Kean-shaped but **multi-mailbox ingest is already the norm** for demos.

### E2E parallel (Playwright)

[`tests/e2e/helpers/waitForAssistantReply.ts`](../../tests/e2e/helpers/waitForAssistantReply.ts) defines **`AssistantReplySnapshot`** (assistant text + structured `ToolCallSnapshot[]`) and **`formatAssistantReplyDiagnostics`** for failures. That pattern — **capture full tool list + final text + attach on failure** — is the UX-shaped cousin of the server-side metrics object.

---

## 3. Proposed layering: “eval helpers” and inspection utilities

The codebase **already** exposes the raw ingredients for rich inspection (`RunAgentEvalCaseResult`, `CollectedAgentPromptMetrics` with `endMessages`). The gap is **operator ergonomics** and **parity with E2E**:

| Layer | Responsibility |
|-------|----------------|
| **Core harness** (keep thin) | Run case, aggregate usage, run `checkExpect`, return pass/fail + reasons. |
| **Shared eval helpers** (new / extracted) | Stable shapes for **export**: e.g. `formatEvalCaseDiagnostics(result)` mirroring `formatAssistantReplyDiagnostics`; optional **normalized tool timeline** (name, error flag, result hash or truncated body) for snapshots and golden diffing. |
| **CLI / report consumer** | `npm run eval:run` already writes JSON reports under `data-eval/eval-runs/`; helpers should make it trivial to print **tool order**, **first/last tool errors**, and **truncated final text** for a failed `id`. |

**Design rule:** Helpers are **read-only views** over harness results — they must not change scoring unless we explicitly add a new `EvalExpect` kind.

**Optional stretch:** A small **Vitest** (or script) that loads the last N reports and fails CI if **pass rate** for a named subset drops below a threshold — separate from “all cases green” local workflow.

---

## 4. Corpus knowledge briefs (“what we know in advance”)

Eval tasks should not be **one-off trivia** scraped from random threads; they should be **grounded in a maintained model of the fixture world**. That model is **not** the LLM — it is **human-curated notes + verified citations** (message ids, subjects, participants) derived from using the product or `ripmail search` on a seeded index.

### 4.1 Two-tier structure

1. **Shared fixture context ([`eval/briefs/enron-shared.md`](../../eval/briefs/enron-shared.md))**  
   **Corpus through 2001-12-31** (no 2002 mail in fixtures); **authoritative “today”** for demo tenants and default Enron v1 eval clock is **2002-01-01** (see `buildDateContext` / `EVAL_ASSISTANT_NOW`). Cross-persona rules: default **Kean** `BRAIN_HOME` for JSONL unless overridden; **absolute dates** in tasks; stable **message id** substrings.

2. **Persona briefs (`eval/briefs/persona-<handle>.md`)**  
   **[`persona-demo-steve-kean.md`](../../eval/briefs/persona-demo-steve-kean.md)**, **[`persona-demo-ken-lay.md`](../../eval/briefs/persona-demo-ken-lay.md)**, **[`persona-demo-jeff-skilling.md`](../../eval/briefs/persona-demo-jeff-skilling.md)** — containing:
   - **Role / point of view** (who they correspond with most).
   - **Recurring themes** evidenced by **specific threads** (subject lines, counterparts, **message ids**).
   - **Negative space**: what they **should not** be assumed to know (other people’s private side threads if not in their maildir).

**Rule:** Every bullet in a brief should ideally map to **at least one** verifiable **mail** anchor (message id or deterministic search query) when used in JSONL—**not** to assumed wiki paths. **Persona briefs do not imply pre-existing wiki pages**; see [`eval/briefs/enron-shared.md`](../../eval/briefs/enron-shared.md#wiki-state-and-eval-assertions).

### 4.2 How briefs feed JSONL cases

| Brief section | Typical `expect` pattern |
|---------------|---------------------------|
| “Janet Butler weekly regulatory updates” | `toolResultIncludes` on known ids + `finalTextIncludes` on factual tokens |
| “User must persist synthesis to disk” | Task must **ask for** a **create/overwrite** (`write`/`edit`); `expect` checks tool output and/or a path the **agent wrote in that turn**—not a page that “should” exist from product chat |
| “Chips / suggest_reply” | `toolNamesIncludeAll` for `suggest_reply_options` |
| Cross-thread reasoning | `read_mail_message` + multiple ids in `toolResultIncludes` |

**User messages** in JSONL should stay **vague and product-native** (no tool names), matching [`eval/tasks/enron-v1.jsonl`](../../eval/tasks/enron-v1.jsonl) style — the brief drives **hidden** expectations, not the literal user prompt.

---

## 5. Operating workflow (best practice)

### When an agent fails in dev or staging

1. **Reproduce** on seeded data (`npm run brain:seed-enron-demo` as needed).
2. **Minimize** a **single-turn** (or intentionally multi-turn, if we add support) user message that triggers the bug.
3. **Add** a new JSONL line with a **kebab `id`** (`enron-NNN-short-slug`) and **narrow** `expect` clauses that fail on the buggy behavior and pass on the fixed behavior.
4. **Run** full Enron JSONL (`npm run eval:run -- --id …` for iteration, then full suite).
5. **Fix** the agent/tool/prompt until the new case **and** all previous cases pass — if an old case is obsolete, **replace** it with a tighter scenario rather than loosening without comment.

### Guardrails

- **Prefer stability over cleverness:** message ids and tool traces beat “the model said something insightful.”
- **Document coupling:** if a case depends on a specific wiki file from an earlier case, note it in the JSONL comment or brief.
- **Tenant hygiene:** cases that mutate wiki under Kean’s home should use **namespaced paths** (`topics/eval-…`) like existing tasks — see comments in `enron-v1.jsonl`.
- **Shared state:** evals and interactive Kean dev share `./data/usr_enrondemo00000000001`; use `npm run dev:eval:clean` or document resets when wiki-mutating cases flake.

### Regression matrix

When changing models or prompts:

- Run the **same** `enron-v1.jsonl` and compare reports (pass rate, `wallMs`, cost) — see [`.cursor/skills/model-eval-benchmark/SKILL.md`](../../.cursor/skills/model-eval-benchmark/SKILL.md).
- Treat **quality regressions** (pass rate down) as **blocking** even if latency improves.

---

## 6. Multi-persona eval expansion

Today’s file is Kean-defaulted. **Forward-compatible** convention:

- **Per-task `brainTenant` field** (future) or **filename split**: `enron-v1-lay.jsonl`, etc., merged by runner.
- **`BRAIN_HOME`** override in CLI/env per suite — already supported for experiments (`eval/README.md`).
- **Brief + task pairing:** Lay tasks must cite **Lay brief** anchors only — avoids false failures from Kean-only threads.

---

## 7. Related documents

| Doc | Link |
|-----|------|
| Eval how-to | [`eval/README.md`](../../eval/README.md) |
| Corpus layout + seeding | [`eval-home-and-mail-corpus.md`](./eval-home-and-mail-corpus.md) |
| Demo auth / tenants | [`enron-demo-tenant.md`](./enron-demo-tenant.md) |
| Wiki vs agent eval research | [`docs/wiki-and-agent-evaluation.md`](../wiki-and-agent-evaluation.md) |
| Playwright Enron E2E | [`tests/e2e/README.md`](../../tests/e2e/README.md) |

---

## 8. Open decisions (for review)

1. **Subset tagging:** optional `tags: ["mail", "wiki", "chips"]` in JSONL for report rollups — requires harness/schema tweak.
2. **LLM-as-judge:** defer until substring coverage is **no longer sufficient** for a class of tasks; keep judge prompts versioned if introduced.

---

*This doc should be updated when the harness gains new expect kinds, multi-turn cases, or CI gates.*
