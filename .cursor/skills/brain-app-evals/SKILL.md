---
name: brain-app-evals
description: Authors, debugs, runs, and interprets brain-app JSONL agent evals (Enron v1, mail-compose v1, wiki v1) and Vitest eval harness tests. Use when adding or fixing eval tasks, running npm run eval:run, interpreting data-eval reports, seeding Enron fixtures, or applying explore-then-assert workflow; complements model-eval-benchmark for cross-model comparisons.
disable-model-invocation: true
---

# Brain-app eval harness (authoring, debug, run, measure)

**Repo source of truth:** [`eval/README.md`](../../../eval/README.md) (commands, env, mail-compose section). **Architecture:** [`docs/architecture/enron-eval-suite.md`](../../../docs/architecture/enron-eval-suite.md), [`docs/architecture/eval-home-and-mail-corpus.md`](../../../docs/architecture/eval-home-and-mail-corpus.md). **Persona/corpus context (no assumed wiki):** [`eval/briefs/enron-shared.md`](../../../eval/briefs/enron-shared.md) and [`eval/briefs/persona-demo-*.md`](../../../eval/briefs/).

From repo root: **`nvm use`** before any `npm` / `npx` (see [`AGENTS.md`](../../../AGENTS.md)).

## Pipeline (`npm run eval:run`)

1. **Vitest** — `vitest.eval.config.ts` → `src/server/evals/**/*.test.ts` (harness/task-file checks; **skipped** if you pass **`--id`** after `--`, for a fast single JSONL case).
2. **JSONL (LLM)** — in one CLI process, in order:
   - **Enron v1** → `data-eval/eval-runs/enron-v1-*.json`
   - **Mail compose v1** (`draft_email`) → `data-eval/eval-runs/mail-compose-v1-*.json`
   - **Wiki v1** (**`wiki-v1.jsonl`** ∪ **`wiki-kean-v1.jsonl`** when `EVAL_WIKI_TASKS` / `EVAL_TASKS` unset) → `data-eval/eval-runs/wiki-v1-*.json`

Entry: `scripts/eval-run.mjs` → `src/server/evals/jsonlSuiteCli.ts`. Standalone CLIs: `enronV1cli.ts`, `mailComposeV1cli.ts`, `wikiV1cli.ts`.

**Prerequisites:** `npm run brain:seed-enron-demo` (Kean index + demo tenants under `./data`); repo `.env` with **`BRAIN_LLM`** and provider keys.

## Authoring new JSONL cases (explore → assert)

Corpus output is hard to predict — **do not** guess final substrings first.

1. Add a task with **`"expect": { "any": [] }`** (vacuous pass; see [`checkExpect`](../../../src/server/evals/harness/checkExpect.ts)).
2. Run one case: **`EVAL_AGENT_TRACE=1 npm run eval:run -- --id <task-id>`** (or set `EVAL_CASE_ID`).
3. Inspect **`data-eval/eval-runs/*.json`**: per case, **`toolNames`**, **`finalText`**, **`toolTextConcat`**, **`failReasons`**, **`error`** (Enron + mail-compose reports include full text fields).
4. If behavior is wrong, **fix the agent or the user message** before tightening `expect`.
5. Replace with real clauses — see [`types.ts`](../../../src/server/evals/harness/types.ts) (`toolResultIncludes`, `finalTextIncludes`, `toolNamesIncludeAll` / `OneOf`, nested `all` / `any`). Prefer **stable** anchors (message ids, verified substrings from tool output).
6. Run **`--id`** until green, then **full** `npm run eval:run` to avoid regressions.

Optional scratch file: **`EVAL_TASKS`** (Enron override), **`EVAL_MAIL_COMPOSE_TASKS`**, **`EVAL_WIKI_TASKS`**.

**Wiki:** Do **not** assert pre-existing wiki paths unless the case or harness **creates** them — [`eval/briefs/enron-shared.md` § Wiki state](../../../eval/briefs/enron-shared.md).

## Task files (default paths)

| Suite | File | Case id prefix |
|-------|------|----------------|
| Enron v1 | `eval/tasks/enron-v1.jsonl` | `enron-` |
| Mail compose v1 | `eval/tasks/mail-compose-v1.jsonl` | `compose-` |
| Wiki v1 | `eval/tasks/wiki-v1.jsonl` ∪ `eval/tasks/wiki-kean-v1.jsonl` | `wiki-`, `wiki-kean-` |

**Default `BRAIN_HOME`:** Kean tenant `usr_enrondemo00000000001` (Steve Kean / `kean-s`). Lay (`…02`) / Skilling (`…03`) require explicit **`BRAIN_HOME`** for JSONL.

**Clock:** Enron + mail-compose default **`EVAL_ASSISTANT_NOW`** to **`2002-01-01`** when unset (fixture mail ends ~2001).

**Sends:** Eval defaults **`EVAL_RIPMAIL_SEND_DRY_RUN=1`** — no real SMTP in benchmarks.

## Debugging failed cases

- Read **`cases[]`** in the latest report: **`ok`**, **`failReasons`**, **`toolNames`**, **`toolTextConcat`**, **`finalText`**.
- Enable **`EVAL_AGENT_TRACE=1`** for **`[eval:agent]`** JSON lines (tool start/end, turns) on stdout.
- Confirm **`ripmail.db`** exists at `$BRAIN_HOME/ripmail/` after seed.
- Wiki v1 failures: check **`.data-eval/wiki-eval-cases/<task-id>/`** isolation vs task message.

## Measuring across models

For pass rate, wall time, tokens, cost across **same** task files: use project skill **model-eval-benchmark** (`.cursor/skills/model-eval-benchmark/SKILL.md`) — same harness, compare `data-eval/eval-runs/*.json` **slugs** (`enron-v1`, `mail-compose-v1`, `wiki-v1`).

## Vitest eval slice

```bash
npx vitest run --config vitest.eval.config.ts
```

Task-file tests live under `src/server/evals/harness/*.test.ts` (e.g. `enronV1Tasks.test.ts`, `mailComposeV1Tasks.test.ts`, `wikiV1Tasks.test.ts`, `wikiKeanV1Tasks.test.ts`). **Default `npm test`** excludes `src/server/evals/**`.

## Implementation references (when changing harness)

- Run case: [`runAgentEvalCase.ts`](../../../src/server/evals/harness/runAgentEvalCase.ts)
- Metrics / trace: [`collectAgentPromptMetrics.ts`](../../../src/server/evals/harness/collectAgentPromptMetrics.ts)
- JSONL runner: [`runLlmJsonlEval.ts`](../../../src/server/evals/harness/runLlmJsonlEval.ts)
- Enron runner: [`runEnronV1.ts`](../../../src/server/evals/runEnronV1.ts); mail-compose: [`runMailComposeV1.ts`](../../../src/server/evals/runMailComposeV1.ts); wiki: [`runWikiV1.ts`](../../../src/server/evals/runWikiV1.ts) (`resolveWikiEvalBundlePaths`, `wiki-kean-v1.jsonl`)

**Note:** Each JSONL case is **one** `userMessage` / **one** session today; true multi-turn chat evals are a separate (future) harness or Playwright.
