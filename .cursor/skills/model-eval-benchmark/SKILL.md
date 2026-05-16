---
name: model-eval-benchmark
description: Runs brain-app JSONL agent evals (Enron v1, mail compose v1, wiki v1) and compares model runs on pass rate, wall time, tokens, and estimated cost from report JSON. Use when benchmarking LLMs, comparing providers, price/performance analysis, or after changing supported-llm-models.json / BRAIN_LLM (+ optional BRAIN_FAST_LLM).
---

# Model eval benchmark (brain-app)

## Goal

Produce a **same-harness, same-tasks** comparison across models on:

| Dimension | Where in report |
|-----------|-----------------|
| **Quality** | `summary.pass`, `summary.fail`, `summary.totalCases` |
| **Latency** | `wallTotalMs` (whole run); per case: each `cases[].wallMs` |
| **Cost** | `summary.totalCost` (USD, from aggregated `usage`) |
| **Volume** | `summary.totalTokens` |

Reports are JSON under `data-eval/eval-runs/` (gitignored).

## Prerequisites

1. **Node:** from repo root, `nvm use` before **`pnpm`** / **`npx`** (see [`AGENTS.md`](../../../AGENTS.md)).
2. **Enron index (Enron + wiki evals):** **`pnpm run brain:seed-enron-demo`** once so `./data/usr_enrondemo00000000001/ripmail/ripmail.db` exists ([`eval/README.md`](../../../eval/README.md)).
3. **API keys:** repo-root `.env` (same as **`pnpm run dev`**) with keys for each provider you run (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY` for Gemini, etc. — matches [`@earendil-works/pi-ai`](../../../docs/architecture/pi-agent-stack.md) conventions).
4. **Model IDs:** each **`BRAIN_LLM`** value must resolve via `parseBrainLlmSpec` → `resolveModel()` / `getModel()` from `@earendil-works/pi-ai`. Git-tracked lineup: [`src/server/evals/supported-llm-models.json`](../../../src/server/evals/supported-llm-models.json) (validated by `vitest.eval.config.ts` tests).

## Commands

**Full eval** (Vitest harness for `src/server/evals/**/*.test.ts`, then JSONL: Enron v1 + **Mail compose v1** + Wiki v1 — one report JSON **per suite**):

```sh
nvm use
pnpm run eval:run -- --provider <KnownProvider> --model <model-id>
```

Flags after `--` apply to the **JSONL phase** only. For JSONL help without running Vitest: **`pnpm run eval:run -- --help`**.

**JSONL only** (advanced): run `enronV1cli.ts`, `mailComposeV1cli.ts`, or `wikiV1cli.ts` with `npx tsx --tsconfig tsconfig.server.json …` from repo root; see [`eval/README.md`](../../../eval/README.md).

Optional env: `EVAL_MAX_CONCURRENCY`, `EVAL_TASKS`, `EVAL_MAIL_COMPOSE_TASKS`, `EVAL_WIKI_TASKS`, `BRAIN_HOME` (defaults to Kean tenant under `./data` when unset and `BRAIN_DATA_ROOT=./data`).

**Implementation note:** The **`package.json`** scripts use `tsx --tsconfig tsconfig.server.json` so `@server/...` imports resolve. If you invoke the CLI by hand, include the same `--tsconfig` or imports break.

## Report files

- Pattern: `data-eval/eval-runs/<slug>-<sanitized-model-id>-<iso-timestamp>.json`
- `slug` = `enron-v1`, **`mail-compose-v1`**, or `wiki-v1`
- `effectiveLlm` and `env` in the JSON record which **provider/model** was used (after CLI overrides)

## Building a comparison table

1. Run the **same** eval (same `EVAL_TASKS` / default `eval/tasks/enron-v1.jsonl`) for each model.
2. Open the **latest** report per model (or a named file).
3. Fill one row per model with: pass rate (`pass/totalCases`), `wallTotalMs`, `totalCost`, `totalTokens`.
4. For **fairer latency** when reasoning about provider speed, prefer **per-case** `wallMs` (mean/median) or keep **`EVAL_MAX_CONCURRENCY` identical** across models — total `wallTotalMs` is pipeline wall clock and is affected by concurrency and which cases slow down.

## Send / outbound mail (important)

The JSONL eval harness **defaults** `send_draft` to **`ripmail send … --dry-run`** so evals do not hit SMTP/Gmail. That is set unless you override it.

- **Default:** dry run (no real send). Good for benchmarks.
- **Real send (rare for evals):** `EVAL_RIPMAIL_SEND_DRY_RUN=0` in the environment.

See `EVAL_RIPMAIL_SEND_DRY_RUN` and `isEvalRipmailSendDryRun` in the server if behavior changes.

## Gotchas to avoid

1. **Apples to apples:** Same task file, same `BRAIN_HOME`, same concurrency when you care about comparable total wall time.
2. **Pass rate is the primary quality signal** on this harness; failed cases include `failReasons` in the report for postmortems.
3. **Cost and tokens** come from the agent’s aggregated usage; if a case fails early, its tokens may still be non-zero — interpret `totalCost` as “spend to reach this outcome,” not only “success cost.”
4. **Model strings:** Use exact pi-ai catalog ids (e.g. `gemini-3-flash-preview` — there is no `gemini-3.1-flash-preview` in the catalog). Wrong ids fail at startup or in registry tests.
5. **Vitest split:** Main **`pnpm run test`** **excludes** `src/server/evals/**`. Harness/registry tests run in the first phase of **`pnpm run eval:run`**, or alone: `npx vitest run --config vitest.eval.config.ts <path>`.
6. **Do not** treat a single run as proof for production: variance (API, cache, model updates) is normal; rerun or pin dependency versions if you need reproducibility.

## Quick comparison snippet (manual)

For each `report.json`:

- Pass rate: `summary.pass / summary.totalCases`
- Cost: `summary.totalCost`
- Tokens: `summary.totalTokens`
- Wall: `wallTotalMs`

Optionally list `cases[].id` + `ok` for failures only.

## Related docs

- [`eval/README.md`](../../../eval/README.md) — build, env, output naming
- [`docs/architecture/pi-agent-stack.md`](../../../docs/architecture/pi-agent-stack.md) — providers and model compatibility
