# Playwright E2E (Enron demo tenant)

Tests hit your **normal local dev setup**: `./data`, port **3000**, `npm run dev`. Enron fixtures use **three tenant dirs** (`usr_enrondemo00000000001` Kean, `…02` Lay, `…03` Skilling — see `eval/fixtures/enron-demo-registry.json`); only auth is special (Bearer + `/demo`). Pre-seed all three with `npm run brain:seed-enron-demo:dev`. This is **not** the LLM eval harness (`data-eval/brain`). See [docs/architecture/enron-demo-tenant.md](../docs/architecture/enron-demo-tenant.md).

## One-time seed (recommended)

Uses the **same tree** dev already serves:

```sh
npm run brain:seed-enron-demo:dev
```

(`BRAIN_DATA_ROOT=./data` — matches [`scripts/run-dev.mjs`](../scripts/run-dev.mjs)); seeds **Kean, Lay, and Skilling** (`--all`). First run downloads the corpus if needed.

## Prerequisites

1. **Repo `.env`** — non-empty `BRAIN_ENRON_DEMO_SECRET` (matches what the server sees after [`loadDotEnv`](../src/server/lib/platform/loadDotEnv.ts)). Playwright merges `.env` in `playwright.config.ts`; no shell export required.
2. **Ripmail** — on `PATH` or `RIPMAIL_BIN`; same binary as dev.

## Run

Terminal A:

```sh
npm run dev
```

Terminal B (after seeding the demo tenant, if needed):

```sh
npm run test:e2e:playwright
```

Uses `http://127.0.0.1:3000` unless you set `PLAYWRIGHT_BASE_URL`.

Tests **skip** if `BRAIN_ENRON_DEMO_SECRET` is still missing after loading `.env`.

## CI

[`.github/workflows/e2e-enron.yml`](../.github/workflows/e2e-enron.yml) shells out a dev server against **`./data`** in the workspace (parallel to local), seeds the demo tenant there, then runs Playwright. Expect **long** runs on cold Enron cache.

## Related

- `npm run test:e2e:enron` — Vitest + ripmail CLI against `data-eval/brain` ([eval/README.md](../eval/README.md)).
- Helper: [`helpers/mintEnronDemoSession.ts`](./helpers/mintEnronDemoSession.ts).
