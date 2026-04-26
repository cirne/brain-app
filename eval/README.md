# Eval home (`data-eval/brain`)

**Architecture (living):** [docs/architecture/eval-home-and-mail-corpus.md](../docs/architecture/eval-home-and-mail-corpus.md)

Integration / e2e fixtures for assistant, wiki, and enrichment agents share one **eval home**: a normal `BRAIN_HOME` tree (`wiki/`, `chats/`, `ripmail/`, …) under [`../shared/brain-layout.json`](../shared/brain-layout.json).

- **Directory** [`data-eval/`](../data-eval/) (gitignored, sibling to `data/`) holds the tarball cache, stamp, and `brain/` tree.
- **Mail** is built from the Enron `kean-s` fixture pipeline (do not commit raw mail; only `data-eval/` on disk, gitignored).

### Enron `kean-s`

**~25k messages** from the [CMU Enron](https://www.cs.cmu.edu/~enron/) `enron_mail_20150507.tar.gz` distribution, user **`kean-s`**, flattened to `maildir/cur/*.eml` and indexed under a synthetic account ([`fixtures/enron-kean-manifest.json`](fixtures/enron-kean-manifest.json)).

Place the tarball at `~/Downloads/enron_mail_20150507.tar.gz` or set `EVAL_ENRON_TAR`. Then:

```bash
npm run eval:build
```

Use `--force` to re-extract and reindex. Stamp: `data-eval/.enron-kean-stamp.json`. Message dates are **1999–2002**; use **absolute date ranges** in search/eval tasks.

**Hosted / Docker:** the same ingest pipeline seeds a **fixed multi-tenant demo workspace** (`BRAIN_DATA_ROOT`, Bearer mint, optional lazy download). See [docs/architecture/enron-demo-tenant.md](../docs/architecture/enron-demo-tenant.md).

## Agent eval suite (Enron v1)

Mail-centric agent tasks (search/read) run against the **large** `kean-s` index. Tasks live in [`tasks/enron-v1.jsonl`](tasks/enron-v1.jsonl) (one JSON object per line; lines starting with `#` are comments). The harness reuses the same `Agent` + tool stack as chat and records per-case **wall time** and `usage` (tokens + `costTotal`) from `agent_end`.

**Build order** (Enron + agent eval):

1. `npm run eval:build` (or ensure `data-eval/brain/ripmail/ripmail.db` exists and matches your stamp)
2. Put provider keys and defaults in the repo-root **`.env`** (same file as `npm run dev` — the eval CLI calls `loadDotEnv()` from the server, cwd = project root). Set `LLM_PROVIDER` / `LLM_MODEL` and the matching `*_API_KEY` (e.g. `ANTHROPIC_API_KEY`).
3. From repo root: `npm run eval:run:enron`

**CLI overrides** (after `npm run`’s `--`): `--provider` / `-p`, `--model` / `-m` set `LLM_PROVIDER` and `LLM_MODEL` for that run (on top of `.env`). Example: `npm run eval:run:enron -- --provider openai --model gpt-5.4`. See `npm run eval:run:enron -- --help`.

**Supported / tested model ids:** the git-tracked registry [`../src/server/evals/supported-llm-models.json`](../src/server/evals/supported-llm-models.json) lists default and candidate `LLM_MODEL` values per `LLM_PROVIDER` (with `tested` flags for baselines). Import from [`supportedLlmModels.ts`](../src/server/evals/supportedLlmModels.ts) in scripts or extend the JSON when you add a new approved eval configuration. Vitest (`npm run eval:run`) asserts every entry resolves with `getModel()` in `@mariozechner/pi-ai`.

**Output:** a JSON report under `data-eval/eval-runs/` (entire `data-eval/` is gitignored), named `enron-v1-<model-segment>-<iso-timestamp>.json`. The **`<model-segment>`** is derived from the effective **`LLM_MODEL`** (the same default as the chat agent if unset), sanitized for the filesystem, so you can `ls data-eval/eval-runs/enron-v1-gpt-5.4-*.json` and compare runs across models without encoding the provider in the name (it is still in the report JSON: `env` and `effectiveLlm`). The runner parallelizes with **p-limit**; tune **`EVAL_MAX_CONCURRENCY`** (default `12`, capped at task count) so many LLM requests stay in flight on a large machine. The bottleneck should be the provider, not local `ripmail` I/O.

| Env | Purpose |
|-----|---------|
| `BRAIN_HOME` | Defaults to `./data-eval/brain` in the npm script |
| `EVAL_MAX_CONCURRENCY` | Max parallel `agent.prompt()` cases (default `12`) |
| `EVAL_TASKS` | Override path to a JSONL task file (default `eval/tasks/enron-v1.jsonl`) |
| `EVAL_FORCE_RUN` | Set to `1` to skip the “at least one API key” preflight (e.g. local Ollama-only setups) |
| `EVAL_AGENT_TRACE` | Set to `1` for `[eval:agent]` JSON lines per case: `turn_start` / `turn_end` = **LLM** time (streaming, reasoning, provider latency); `tool_start` / `tool_end` = tool execution (often ripmail). Gaps in `[ripmail]` logs are usually the model working, or another eval case interleaving stdout (high concurrency). |
| `BRAIN_RIPMAIL_SUBPROCESS_LOG` | Set to `errors` (or `0` / `off`) to **omit** successful ripmail logs (command line + metadata JSON); still logs failures, timeouts, and `send`. |

`npm test` / main Vitest do **not** run agent eval; use the command above. **`npm run eval:run`** still runs `src/server/evals/**/*.test.ts` (harness + smoke) with `BRAIN_HOME=./data-eval/brain` and no LLM by default.

## Wiki buildout + cleanup (lint) eval (wiki v1)

Two tasks in [`tasks/wiki-v1.jsonl`](tasks/wiki-v1.jsonl): **`buildout`** uses [`getOrCreateWikiBuildoutAgent`](../src/server/agent/wikiBuildoutAgent.ts) (write + `search_index`, same as Your Wiki enrich); **`cleanup`** uses [`createCleanupAgent`](../src/server/agent/agentFactory.ts) (read / grep / find / `edit` — no `write`).

**Requirements:** same **Enron** index as the mail eval (`data-eval/brain/ripmail/ripmail.db`) so buildout can run `search_index`. CLI: `npm run eval:run:wiki` (`.env` + optional `--provider` / `--model` like Enron). Reports: `data-eval/eval-runs/wiki-v1-<model-segment>-<timestamp>.json` (see Enron section for naming) with per-case `usage`, `toolNames`, and `agent` field.

| Env | Purpose |
|-----|---------|
| `EVAL_WIKI_TASKS` | Override path to wiki JSONL (default `eval/tasks/wiki-v1.jsonl`) |
| `EVAL_TASKS` | Wiki: used when `EVAL_WIKI_TASKS` is unset. Enron v1: overrides the default enron task file. |
| `EVAL_MAX_CONCURRENCY` | Default `2` (two agents); raise if you add more tasks |

Expectations in JSONL can use **`toolNamesIncludeAll`** / **`toolNamesIncludeOneOf`** (see [`src/server/evals/harness/types.ts`](../src/server/evals/harness/types.ts)).

## npm scripts

| Script | Purpose |
|--------|---------|
| `eval:build` | Enron `kean-s` tarball → ~25k `.eml` → index (see [`enron-kean-manifest.json`](fixtures/enron-kean-manifest.json)) |
| `eval:run` | Vitest for `src/server/evals/` with `BRAIN_HOME=./data-eval/brain` |
| `eval:run:assistant` | Same, scoped to assistant evals folder |
| `eval:run:enron` | Enron v1 JSONL agent eval (writes `data-eval/eval-runs/enron-v1-<model>-*.json`); needs LLM keys |
| `eval:run:wiki` | Wiki buildout + cleanup JSONL eval (writes `data-eval/eval-runs/wiki-v1-<model>-*.json`); needs LLM + Enron index |

`npm run ripmail:build` (or `ripmail` on `PATH`); eval scripts prefer `target/release/ripmail`. To reindex after hand-editing maildir: `RIPMAIL_HOME=./data-eval/brain/ripmail BRAIN_HOME=./data-eval/brain ./target/release/ripmail rebuild-index`.

## `ripmail status` and date range

`status` reports **`mailboxes[].earliestDate` / `latestDate`** as **`MIN(date)` / `MAX(date)`** in the SQLite `messages` table (strings stored as **UTC** RFC3339 from parsing).

**Index date normalization (ingest):** Dates used for the index that are strictly before **1990-01-01 UTC**, or that are not valid RFC3339 after parse, are treated as untrustworthy. At **`rebuild-index`**, they are replaced by the **minimum trustworthy date in the same maildir batch** (or the message is **skipped** if there is no trustworthy anchor in the batch). During **IMAP / Apple Mail** ingest, they are replaced by the existing **`MIN(date)`** for that mailbox, or **skipped** if the mailbox has no rows yet. Each adjustment prints **`ripmail: warning: index date …`** on stderr. If these warnings show up often in production, investigate; they are expected mainly from legacy exports and eval corpora (see below), not from typical Apple/Google sync.

For the **Enron `kean-s`** fixture (before or without a rebuild that applies the above): **Latest** matches the bulk of the mail (**~2001**). **Earliest** could show **`1980-01-01T00:00:00+00:00`** even though most messages are **1997–2001** — about **102** files have a **`Date:`** in **late December 1979 (US time zones)**; in UTC that is **1980-01-01** (e.g. `Date: Mon, 31 Dec 1979 16:00:00 -0800` → `1980-01-01T00:00:00+00:00`). After **`rebuild-index`** with current ripmail, those rows are clamped to the batch minimum trustworthy date (roughly **1997+** for this corpus), so **`earliestDate`** aligns with the main message span.

**Practical “Enron years” span** for eval tasks when comparing against raw SQL: `MIN(date)` with `date >= '1990-01-01'` is about **1997-03** through **2001-12** on a legacy index; on a fresh rebuild with normalization, use `status` / `MIN(date)` directly.

## Time-relative queries

Fixture mail is **old** (1997–2001 for Enron). Searches for “yesterday” or default short windows will often return **no hits**. Use **absolute dates** in eval tasks, or date-shift the corpus in a later iteration — see [wiki and agent evaluation](../docs/wiki-and-agent-evaluation.md).

## PII and licensing

Enron is a public research corpus; do not commit raw mail into git. Keep extracted material only under the ignored `data-eval/` tree and follow the dataset hosts’ terms.

## CI

Cache `data-eval/` or pre-seed the Enron tarball; run `eval:build` on cache miss. `npm test` does **not** run `src/server/evals/`; use `eval:run` after a successful build.
