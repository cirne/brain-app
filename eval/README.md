# Eval home (`data-eval/brain`)

**Architecture (living):** [docs/architecture/eval-home-and-mail-corpus.md](../docs/architecture/eval-home-and-mail-corpus.md)

Integration / e2e fixtures for assistant, wiki, and enrichment agents share one **eval home**: a normal `BRAIN_HOME` tree (`wiki/`, `chats/`, `ripmail/`, …) under [`../shared/brain-layout.json`](../shared/brain-layout.json).

- **Directory** [`data-eval/`](../data-eval/) (gitignored, sibling to `data/`) holds the tarball cache, stamp, and `brain/` tree. **Wiki JSONL cases** also write **`.data-eval/wiki-eval-cases/<task-id>/wiki/`** (gitignored), reset at each case start and kept after the run for inspection.
- **Mail** is built from the Enron `kean-s` fixture pipeline (do not commit raw mail; only `data-eval/` on disk, gitignored).

### Enron `kean-s`

**~25k messages** from the [CMU Enron](https://www.cs.cmu.edu/~enron/) `enron_mail_20150507.tar.gz` distribution, user **`kean-s`**, flattened to `maildir/cur/*.eml` and indexed under a synthetic account ([`fixtures/enron-kean-manifest.json`](fixtures/enron-kean-manifest.json)).

Place the tarball at `~/Downloads/enron_mail_20150507.tar.gz`, set `EVAL_ENRON_TAR`, **or run `npm run eval:build` with neither** — the script downloads CMU’s `enron_mail_20150507.tar.gz` once (**prefers `curl`** with resume on `*.part`; SHA-checked) into **`data-eval/.cache/enron/enron_mail_20150507.tar.gz`** and reuses it on later runs. Set **`EVAL_ENRON_USE_NODE_FETCH=1`** to force Node’s `fetch` downloader. Override the URL with `ENRON_SOURCE_URL` or the hash with `ENRON_SHA256` if you mirror the file.

```bash
npm run eval:build
```

Use `--force` to re-extract and reindex. Stamp: `data-eval/.enron-kean-stamp.json`. Message dates are **1999–2002**; use **absolute date ranges** in search/eval tasks.

**Hosted / Docker:** the same ingest pipeline seeds a **fixed multi-tenant demo workspace** (`BRAIN_DATA_ROOT`, Bearer mint, optional lazy download). See [docs/architecture/enron-demo-tenant.md](../docs/architecture/enron-demo-tenant.md).

## `npm run eval:run`

One script runs the **whole eval pipeline** (same `BRAIN_HOME` as below):

1. **Vitest** — `vitest.eval.config.ts` → `src/server/evals/**/*.test.ts` (harness, registry, smoke; **no** JSONL / LLM unless a test opts in).
2. **JSONL LLM suites** — Enron v1, then Wiki v1. Each suite writes **one report** under `data-eval/eval-runs/` (`enron-v1-*.json`, `wiki-v1-*.json`).

**Build order:**

1. `npm run eval:build` (or ensure `data-eval/brain/ripmail/ripmail.db` exists and matches your stamp)
2. Put provider keys and defaults in the repo-root **`.env`** (same file as `npm run dev`). Set `LLM_PROVIDER` / `LLM_MODEL` and the matching `*_API_KEY` (e.g. `ANTHROPIC_API_KEY`).
3. `npm run eval:run`  
   Optional: `npm run eval:run -- --provider openai --model gpt-5.4` — flags apply to the **JSONL phase** only (after Vitest) and **override** repo-root `.env` for `LLM_PROVIDER` / `LLM_MODEL` (the loader sets those from `.env` after your shell exports, so use `-p`/`-m` for one-off providers).  
   **Local MLX (Qwen on Apple Silicon):** start `mlx_lm.server` (see `.env.example`), then e.g. `npm run eval:run -- -p mlx-local -m mlx-community/Qwen3.6-27B-4bit --id enron-004-no-hit-xyzzy` (no cloud API key).  
   **Single case:** `npm run eval:run -- --id enron-022-suggest-reply-chips` (skips Vitest, runs only that Enron v1 case — or the matching id in the wiki file). Same as `EVAL_CASE_ID=enron-022-suggest-reply-chips` for the JSONL phase.  
   `npm run eval:run -- --help` prints JSONL CLI help and **skips** Vitest.

**Advanced (one JSONL suite only):** from repo root, run `enronV1cli.ts` or `wikiV1cli.ts` with `npx tsx --tsconfig tsconfig.server.json …` (see `--help` on each file).

## JSONL LLM evals (Enron-backed)

All live JSONL suites use the same **`BRAIN_HOME`** and **Enron** `ripmail.db`. Invoked as phase 2 of `npm run eval:run` (see above).

## Agent eval suite (Enron v1)

Mail-centric agent tasks (search/read) run against the **large** `kean-s` index. Tasks live in [`tasks/enron-v1.jsonl`](tasks/enron-v1.jsonl) (one JSON object per line; lines starting with `#` are comments). The harness reuses the same `Agent` + tool stack as chat and records per-case **wall time** and `usage` (tokens + `costTotal`) from `agent_end`.

**Supported / tested model ids:** the git-tracked registry [`../src/server/evals/supported-llm-models.json`](../src/server/evals/supported-llm-models.json) lists default and candidate `LLM_MODEL` values per `LLM_PROVIDER` (with `tested` flags for baselines). Import from [`supportedLlmModels.ts`](../src/server/evals/supportedLlmModels.ts) in scripts or extend the JSON when you add a new approved eval configuration. The Vitest phase of `npm run eval:run` asserts every entry resolves via `resolveModel()` (pi-ai registry plus Brain-only providers such as `mlx-local`).

**Output:** a JSON report under `data-eval/eval-runs/` (entire `data-eval/` is gitignored), named `enron-v1-<model-segment>-<iso-timestamp>.json`. The **`<model-segment>`** is derived from the effective **`LLM_MODEL`** (the same default as the chat agent if unset), sanitized for the filesystem, so you can `ls data-eval/eval-runs/enron-v1-gpt-5.4-*.json` and compare runs across models without encoding the provider in the name (it is still in the report JSON: `env` and `effectiveLlm`). The runner parallelizes with **p-limit**; tune **`EVAL_MAX_CONCURRENCY`** (default `12`, capped at task count) so many LLM requests stay in flight on a large machine. The bottleneck should be the provider, not local `ripmail` I/O.

| Env | Purpose |
|-----|---------|
| `BRAIN_HOME` | Defaults to `./data-eval/brain` in the npm script |
| `EVAL_MAX_CONCURRENCY` | Max parallel `agent.prompt()` cases (default `12`) |
| `EVAL_CASE_ID` | Run a **single** task: set to its JSONL `id` (same as CLI `--id`). The combined `jsonl` runner exits 1 if the id is not in **either** the Enron or wiki task file. |
| `EVAL_TASKS` | Override path to a JSONL task file (default `eval/tasks/enron-v1.jsonl`) |
| `EVAL_ASSISTANT_NOW` | Optional **`YYYY-MM-DD`** (or ISO8601) used as the assistant’s clock for session date/time in the system prompt—so “today” / relative mail windows match historical eval corpora (Enron mail is ~1999–2002). The **Enron v1** runner sets default **`2002-01-01`** when unset; override for experiments. |
| `EVAL_AGENT_TRACE` | Set to `1` for `[eval:agent]` JSON lines per case: `turn_start` / `turn_end` = **LLM** time (streaming, reasoning, provider latency); `tool_start` / `tool_end` = tool execution (often ripmail). Gaps in `[ripmail]` logs are usually the model working, or another eval case interleaving stdout (high concurrency). |
| `BRAIN_RIPMAIL_SUBPROCESS_LOG` | Set to `errors` (or `0` / `off`) to **omit** successful ripmail logs (command line + metadata JSON); still logs failures, timeouts, and `send`. |

`npm test` / main Vitest **exclude** `src/server/evals/**`. Use **`npm run eval:run`** for the eval Vitest slice plus all JSONL LLM suites.

## Wiki buildout + cleanup (lint) eval (wiki v1)

Two tasks in [`tasks/wiki-v1.jsonl`](tasks/wiki-v1.jsonl): **`buildout`** uses [`getOrCreateWikiBuildoutAgent`](../src/server/agent/wikiBuildoutAgent.ts) (write + `search_index`, same as Your Wiki enrich); **`cleanup`** uses [`createCleanupAgent`](../src/server/agent/agentFactory.ts) (read / grep / find / `edit` — no `write`).

**Isolated vault per case:** Each JSONL row runs in a **subprocess** with its own `BRAIN_WIKI_ROOT` parent at **`.data-eval/wiki-eval-cases/<task-id>/`** (stable name from the JSONL `id`). The orchestrator **removes and recreates** that directory at **case start**, then the child seeds the starter wiki and copies [`fixtures/enron-kean-wiki/me.md`](fixtures/enron-kean-wiki/me.md) and [`assistant.md`](fixtures/enron-kean-wiki/assistant.md). The tree is **not deleted** after the case so you can inspect **`./.data-eval/wiki-eval-cases/<id>/wiki/`**. (`.data-eval/` is gitignored like `data-eval/`.)

**CLI:** [`wikiV1cli`](../src/server/evals/wikiV1cli.ts) and `npm run eval:run` accept **`--brain-wiki-root <path>`** (same as setting `BRAIN_WIKI_ROOT` to an absolute path; flag **overrides** env for that process). The orchestrator normally sets per-case roots under `.data-eval/wiki-eval-cases/`; use `--brain-wiki-root` manually for a single long run (e.g. `manualWikiFullBuildoutCli`) when you want a fixed vault parent elsewhere.

**Wiki buildout-only tasks:** [`tasks/wiki-buildout-v1.jsonl`](tasks/wiki-buildout-v1.jsonl) — multiple **buildout** cases grounded in the same Enron golden message ids as `enron-v1.jsonl`. Example:

```bash
BRAIN_HOME=./data-eval/brain EVAL_WIKI_TASKS=eval/tasks/wiki-buildout-v1.jsonl npx tsx --tsconfig tsconfig.server.json src/server/evals/wikiV1cli.ts
```

**Manual full first buildout** (one `WIKI_EXPANSION_INITIAL_MESSAGE` pass — inspect `wiki/` on disk after; optional `--brain-wiki-root` for a split vault parent):

```bash
BRAIN_HOME=./data-eval/brain npx tsx --tsconfig tsconfig.server.json src/server/evals/manualWikiFullBuildoutCli.ts
```

See [`manualWikiFullBuildoutCli.ts`](../src/server/evals/manualWikiFullBuildoutCli.ts) (`--help` for flags).

**Requirements:** same **Enron** index as the mail eval (`data-eval/brain/ripmail/ripmail.db`) so buildout can run `search_index`. Runs as part of `npm run eval:run` (JSONL phase), or invoke `wikiV1cli.ts` directly for wiki-only. Reports: `data-eval/eval-runs/wiki-v1-<model-segment>-<timestamp>.json` (see Enron section for naming) with per-case `usage`, `toolNames`, and `agent` field.

| Env | Purpose |
|-----|---------|
| `EVAL_WIKI_TASKS` | Override path to wiki JSONL (default `eval/tasks/wiki-v1.jsonl`) |
| `EVAL_TASKS` | Wiki: used when `EVAL_WIKI_TASKS` is unset. Enron v1: overrides the default enron task file. |
| `EVAL_MAX_CONCURRENCY` | Max **parallel subprocesses** for wiki cases (default `12`, capped by task count; same knob as Enron) |
| `EVAL_SUBPROCESS_REPORT_FILE` | Internal: child writes one-case JSON result for the parent (do not set by hand) |

Expectations in JSONL can use **`toolNamesIncludeAll`** / **`toolNamesIncludeOneOf`** (see [`src/server/evals/harness/types.ts`](../src/server/evals/harness/types.ts)).

## npm scripts

| Script | Purpose |
|--------|---------|
| `eval:build` | Enron `kean-s` tarball → ~25k `.eml` → index (see [`enron-kean-manifest.json`](fixtures/enron-kean-manifest.json)) |
| `eval:run` | [`scripts/eval-run.mjs`](../scripts/eval-run.mjs): Vitest (`vitest.eval.config.ts`) then all JSONL LLM suites (Enron v1, Wiki v1). `BRAIN_HOME=./data-eval/brain`. Pass `--provider` / `--model` / `--help` after `--` for the JSONL phase. Wiki-only or buildout-only JSONL: use `npx tsx … wikiV1cli.ts` with `EVAL_WIKI_TASKS`; manual full buildout: `npx tsx … manualWikiFullBuildoutCli.ts` (see Wiki section above). |

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
