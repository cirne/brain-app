# LLM eval harness (Enron mail)

**Architecture (living):** [docs/architecture/eval-home-and-mail-corpus.md](../docs/architecture/eval-home-and-mail-corpus.md)

Integration evals for assistant, wiki, and enrichment agents use the **same multi-tenant layout as `npm run dev`**: mail and ripmail live under **`BRAIN_DATA_ROOT`**. By default (`npm run eval:run`) that is **`./data`**, and the Enron **Kean** corpus is indexed at **`./data/usr_enrondemo00000000001/`** (same tenant as the Kean demo persona). Wiki JSONL cases still use isolated vault parents under **`.data-eval/wiki-eval-cases/<task-id>/`** (gitignored). JSON eval reports are written under **`data-eval/eval-runs/`** (gitignored).

**Zero-hit search metadata:** When `search_index` / ripmail search returns **`totalMatched === 0`**, the JSON includes structured **`effectiveSearch`**, **`constraintsPresent`**, and **`suggestedRelaxations`** (stable IDs). **High-recall / broad pools:** when **`totalMatched`** exceeds **`limit`** or is ≥ **50**, JSON adds **`recallSummary`** (counts + stable **`reasons`**) and **`suggestedNarrowings`**. Coverage: **`src/server/ripmail/ripmail.test.ts`** (no dedicated JSONL eval for these paths yet).

## Seed the Enron corpora

**Three demo tenants** (Kean, Lay, Skilling) plus the indexes LLM evals need:

```bash
npm run brain:seed-enron-demo
```

This runs with `BRAIN_DATA_ROOT=./data` and `--all` (see `package.json`). Use **`npm run brain:seed-enron-demo -- --force`** to wipe and rebuild tenant dirs from the tarball.

Place `enron_mail_20150507.tar.gz` via **`EVAL_ENRON_TAR`**, or let the scripts download CMU’s archive once (**prefers `curl`**, SHA-checked) into **`./data/.cache/enron/enron_mail_20150507.tar.gz`**. Set **`EVAL_ENRON_USE_NODE_FETCH=1`** to force Node `fetch`. Override URL/hash with **`ENRON_SOURCE_URL`** / **`ENRON_SHA256`** when mirroring.

### Enron `kean-s` (eval mail)

**~25k messages** from [CMU Enron](https://www.cs.cmu.edu/~enron/) for mailbox **`kean-s`**, flattened to `.eml` and indexed per [`fixtures/enron-kean-manifest.json`](fixtures/enron-kean-manifest.json). Lay/Skilling use sibling manifests in [`fixtures/enron-demo-registry.json`](fixtures/enron-demo-registry.json).

Message dates are **1999–2002**; use **absolute date ranges** in search/eval tasks.

Braintunnel demo handles (stored slugs; leading `@` is accepted in UI and normalized away): **`demo-steve-kean`**, **`demo-ken-lay`**, **`demo-jeff-skilling`**. Archive maildir ids (`kean-s`, etc.) are fixture-only.

**Persona briefs (eval + agent authoring):** [briefs/enron-shared.md](briefs/enron-shared.md) (corpus **through 2001-12-31**, assistant **today** **2002-01-01** for demos + default eval clock). Per persona: [briefs/persona-demo-steve-kean.md](briefs/persona-demo-steve-kean.md), [briefs/persona-demo-ken-lay.md](briefs/persona-demo-ken-lay.md), [briefs/persona-demo-jeff-skilling.md](briefs/persona-demo-jeff-skilling.md). See [docs/architecture/enron-eval-suite.md](../docs/architecture/enron-eval-suite.md) for how briefs feed tasks.

### Related: end-to-end testing

| Command | What it exercises |
|---------|-------------------|
| `npm run test:e2e:enron` | TypeScript maildir → SQLite rebuild + deterministic checks on **`./data/usr_enrondemo00000000001`** (skips if seed not run). Config: [`vitest.enron-e2e.config.ts`](../vitest.enron-e2e.config.ts). |
| `npm run test:e2e:playwright` | **Demo tenants** in **`./data`** with **`npm run dev`** (**:3000**). Pre-seed with `npm run brain:seed-enron-demo`. See [`tests/e2e/README.md`](../tests/e2e/README.md). |

## `npm run eval:run`

Runs the **whole eval pipeline** with **`BRAIN_DATA_ROOT=./data`**:

1. **Vitest** — `vitest.eval.config.ts` → `src/server/evals/**/*.test.ts`.
2. **JSONL LLM suites** — Enron v1, **Mail compose v1** (`draft_email`), **B2B E2E** (`b2b-e2e.jsonl`), then Wiki v1 (**wiki-v1.jsonl** ∪ **wiki-kean-v1.jsonl** unless `EVAL_WIKI_TASKS` overrides). Reports under **`data-eval/eval-runs/`**.

**Prerequisites:**

1. **`npm run brain:seed-enron-demo`** so `./data/usr_enrondemo00000000001/ripmail/ripmail.db` exists (and sibling demo tenants if you use `/demo`).
2. Repo-root **`.env`** with **`BRAIN_LLM`** and provider keys (same as dev).

Optional: `npm run eval:run -- --provider openai --model gpt-5.4` (JSONL phase). Single case: `npm run eval:run -- --id enron-022-suggest-reply-chips` skips Vitest. `--help` skips Vitest.

Default **`BRAIN_HOME`** for JSONL (when unset) is **Kean’s tenant dir** under `./data`. Override with **`BRAIN_HOME`** for experiments.

## JSONL LLM evals (Enron-backed)

Tasks in [`tasks/enron-v1.jsonl`](tasks/enron-v1.jsonl). Harness matches production `Agent` + tools.

| Env | Purpose |
|-----|---------|
| `BRAIN_HOME` | Optional override; default Kean tenant under `$BRAIN_DATA_ROOT` |
| `BRAIN_DATA_ROOT` | Set by `eval:run` to `./data`; required for default brain resolution |
| `EVAL_MAX_CONCURRENCY` | Parallel cases (default **16**; single source: `src/server/evals/harness/defaultEvalConcurrency.ts`) |
| `EVAL_CASE_ID` / `--id` | Single task id |
| `EVAL_TASKS` | Override Enron JSONL path |
| `EVAL_ASSISTANT_NOW` | Clock for relative mail windows (Enron v1 defaults `2002-01-01` when unset) |
| `EVAL_AGENT_TRACE` | `1` for per-case `[eval:agent]` JSON lines (tool / turn timeline on stdout) |
| `BRAIN_RIPMAIL_SUBPROCESS_LOG` | `errors` to quiet successful ripmail subprocess logs |

### B2B evals (all suites in parallel)

`npm run eval:b2b` starts **preflight**, **filter**, **research-only**, and **E2E** (`b2b-e2e.jsonl`) as **four parallel workers** (separate processes). Wall time is roughly the **slowest** suite, not the sum. Do not pass `--id` unless that id exists in every suite’s JSONL; use a single-suite command instead.

| Script | Suite |
|--------|--------|
| `npm run eval:b2b` | All of the below, parallel |
| `npm run eval:b2b:preflight` | Preflight classifier only |
| `npm run eval:b2b:filter` | Privacy filter LLM only (`b2b-filter.jsonl`; each scenario × 3 built-in policies) — **breadth** for policy/redaction |
| `npm run eval:b2b:research` | Research agent only (no filter; `b2b-research-v1.jsonl`) — **breadth** for tools |
| `npm run eval:b2b:e2e` | **Slim full tunnel** — research + filter (`b2b-e2e.jsonl`). Aliases: `eval:b2b:v1`, `eval:b2b:policies` |

Kebab aliases (`eval:b2b-preflight`, etc.) call the same commands as the colon scripts.

Any failing case sets the suite process **exit code to 1** (`runLlmJsonlEval`); `eval:b2b` exits 1 if any worker fails.

### B2B end-to-end eval (slim)

[`tasks/b2b-e2e.jsonl`](tasks/b2b-e2e.jsonl) — **research (tools) + privacy filter**, same production path as the tunnel. Intentionally **few** cases (mixed Kean↔Lay directions, one Trusted travel smoke with **LLM judge**). **Policy presets** and redaction scenarios: use **`eval:b2b:filter`**. **Tooling / mail depth:** use **`eval:b2b:research`**.

Regenerate after changing tasks in `generateB2bE2eJsonl.ts`:

```bash
npx tsx --tsconfig tsconfig.server.json src/server/evals/generateB2bE2eJsonl.ts
```

```bash
npm run eval:b2b:e2e
npm run eval:b2b:e2e -- --id b2b-e2e-004-trusted-travel-kean-lay
```

| Env | Purpose |
|-----|---------|
| `EVAL_B2B_E2E_TASKS` | Override JSONL path (default `eval/tasks/b2b-e2e.jsonl`) |
| `EVAL_B2B_TASKS` / `EVAL_B2B_POLICY_TASKS` | Legacy overrides (same as E2E path) |
| `BRAIN_EVAL_JUDGE_LLM` | Judge model when a case uses `llmJudge` |

### B2B tunnel preflight eval (fast LLM)

[`tasks/b2b-preflight.jsonl`](tasks/b2b-preflight.jsonl) labels whether each inbound tunnel message should run the research+draft pipeline. The harness uses the same preflight agent stack as production: **optional `BRAIN_FAST_LLM`** (cheaper model when set); **when unset, preflight uses `BRAIN_LLM`** (standard tier). No tools. **No ripmail seed** is required.

```bash
npm run eval:b2b:preflight
npm run eval:b2b:preflight -- --id b2b-preflight-thanks
```

| Env | Purpose |
|-----|---------|
| `EVAL_B2B_PREFLIGHT_TASKS` | Override JSONL path (default `eval/tasks/b2b-preflight.jsonl`) |

## Authoring a new eval: explore, then assert

The corpus is **large** and **not memorized** while you write tasks. You usually **cannot** predict the exact **tool order**, **tool bodies**, or **final wording** from a user message alone. Treat it as a **two-phase** workflow.

### Phase 1 — Run without meaningful asserts (explore)

1. **Add a new task** — stable `id` (e.g. `enron-NNN-short-slug`), realistic **`userMessage`** (vague, product-shaped; no tool names), seed + `BRAIN_HOME` as needed (see [persona briefs](briefs/enron-shared.md)).
2. **Use a vacuous `expect`** so the harness records behavior but does not fail on scoring yet:
   ```json
   "expect": { "any": [] }
   ```
   An empty `any` list is treated as **always pass** (see [`checkExpect`](../src/server/evals/harness/checkExpect.ts)).
3. **Run a single case** (skips the slow Vitest phase when you pass `--id`):

   ```bash
   nvm use
   EVAL_AGENT_TRACE=1 npm run eval:run -- --id your-case-id
   ```

   Optional: point at a scratch file while iterating — `EVAL_TASKS=/abs/or/relative/path/to/scratch.jsonl` (same CLI).

4. **Inspect output**
   - **Stdout:** with `EVAL_AGENT_TRACE=1`, `[eval:agent]` JSON lines show **tool starts/ends** and turn boundaries.
   - **Report:** under `data-eval/eval-runs/*.json` (gitignored). Each Enron case includes **`toolNames`**, **`finalText`**, **`toolTextConcat`**, **`usage`**, **`failReasons`** (empty when `expect` passed), and **`error`** if the run threw.

5. **If something is wrong** — bad retrieval, wrong tool, brittle prompt, or product bug — **fix the agent or the task** *before* you invest in expectations. Do not “paper over” a broken trace with loose asserts.

### Phase 2 — Lock expectations (validate)

After the trace matches intent:

1. Replace `"expect": { "any": [] }` with **`toolResultIncludes`**, **`finalTextIncludes`** / **`finalTextIncludesOneOf`**, **`toolNamesIncludeAll`** / **`toolNamesIncludeOneOf`**, or composed **`all`** / **`any`** — see [`types.ts`](../src/server/evals/harness/types.ts).
2. Prefer **stable** anchors (**message ids**, exact substrings from **verified** tool output, tool **names** in order) over subjective phrasing.
3. **Wiki:** follow [briefs/enron-shared.md — Wiki state and eval assertions](briefs/enron-shared.md#wiki-state-and-eval-assertions): only assert on paths the case **creates** or setup establishes.
4. Run **`--id`** until green, then run the **full** JSONL suite (or full `npm run eval:run`) so you do not regress other cases.
5. **LLM-as-judge** (or other soft scorers) — use **in addition to** or **only after** substring checks are impractical; keep judge prompts versioned if you add them (see [OPP-065](../docs/opportunities/OPP-065-wiki-eval-llm-as-judge.md)).

### Related

- [Persona + shared briefs](briefs/enron-shared.md) — mail-only vs wiki setup, date anchor **2002-01-01**.
- [Enron eval suite architecture](../docs/architecture/enron-eval-suite.md) — workflow and guardrails.

## Mail compose v1 (`draft_email`)

Single-turn tasks in [`tasks/mail-compose-v1.jsonl`](tasks/mail-compose-v1.jsonl) exercise **search/read → `draft_email`** (reply or new) on the **Steve Kean** default tenant (`usr_enrondemo00000000001` / `kean-s`), same as Enron v1. Prompts ask for **draft only** (no send). Real sends stay **dry-run** via default `EVAL_RIPMAIL_SEND_DRY_RUN=1`.

| Env | Purpose |
|-----|---------|
| `EVAL_MAIL_COMPOSE_TASKS` | Optional absolute/relative path to override the JSONL file |
| (others) | Same as Enron table: `BRAIN_HOME`, `EVAL_CASE_ID` / `--id`, `EVAL_AGENT_TRACE`, `EVAL_ASSISTANT_NOW`, … |

**CLI (JSONL only):** `npx tsx --tsconfig tsconfig.server.json src/server/evals/mailComposeV1cli.ts [--id compose-001-…]`

**Report:** `data-eval/eval-runs/mail-compose-v1-<model>-<timestamp>.json`

Author new cases with the same **explore → assert** flow as [`#authoring-a-new-eval-explore-then-assert`](#authoring-a-new-eval-explore-then-assert); assert on **`draft_email`** tool text (`To:`, `Subject:`, message ids in the transcript) not on pre-existing wiki.

## Wiki buildout + cleanup (wiki v1)

[`tasks/wiki-v1.jsonl`](tasks/wiki-v1.jsonl) loads first; **unless** **`EVAL_WIKI_TASKS`** or **`EVAL_TASKS`** overrides the path, [`tasks/wiki-kean-v1.jsonl`](tasks/wiki-kean-v1.jsonl) is **concatenated** (Steve Kean / `kean-s` persona arcs on the default tenant — see [briefs/persona-demo-steve-kean.md](briefs/persona-demo-steve-kean.md)). Cases share one **`wiki-v1-*.json`** report slug. Per-case **`BRAIN_WIKI_ROOT`** under **`.data-eval/wiki-eval-cases/<task-id>/`**.

Example (wiki buildout-only file):

```bash
EVAL_WIKI_TASKS=eval/tasks/wiki-buildout-v1.jsonl npx tsx --tsconfig tsconfig.server.json src/server/evals/wikiV1cli.ts
```

Manual full buildout:

```bash
npx tsx --tsconfig tsconfig.server.json src/server/evals/manualWikiFullBuildoutCli.ts
```

Requires the same Kean ripmail index as mail eval (`./data/usr_enrondemo00000000001/ripmail/ripmail.db`).

## npm scripts

| Script | Purpose |
|--------|---------|
| `brain:seed-enron-demo` | Seeds **all three** Enron demo tenants under `./data` (tarball download/cache + ingest). |
| `eval:run` | Vitest eval slice + Enron v1 + mail compose + **B2B E2E** + Wiki v1 JSONL (`scripts/eval-run.mjs`). |

`npm run ripmail:build`; eval prefers `target/release/ripmail`. Reindex example:

```bash
RIPMAIL_HOME=./data/usr_enrondemo00000000001/ripmail BRAIN_HOME=./data/usr_enrondemo00000000001 ./target/release/ripmail rebuild-index
```

## `ripmail status` and date range

Same behavior as product ripmail—see prior sections in this file for Enron date quirks (legacy index vs rebuild normalization).

## Time-relative queries

Fixture mail is old (1997–2001). Prefer **absolute dates** in tasks—see [wiki and agent evaluation](../docs/wiki-and-agent-evaluation.md).

## PII and licensing

Do not commit raw mail. Large downloads live under ignored `./data/.cache/` and tenant trees under ignored `./data/`.

## CI

Cache `./data/.cache/enron/` or pre-seed the tarball; run **`npm run brain:seed-enron-demo`** before **`npm run eval:run`**. `npm test` does not include `src/server/evals/**`.

## Shared state caveat

Running **`eval:run`** while actively using the **Kean** demo workspace in the app mutates the same `./data/usr_enrondemo00000000001` tree. Use **`npm run dev:eval:clean`** to reset wiki/chats/cache for that tenant without removing mail, or re-seed with `--force` for a full rebuild.
