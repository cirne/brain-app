# Enron demo tenant (hosted testing)

**OPP-051 Phase 0 + multi-mailbox demos.** Multi-tenant deployments (`BRAIN_DATA_ROOT` set) expose **three fixed demo workspaces** with Braintunnel handles **`demo-steve-kean`**, **`demo-ken-lay`**, **`demo-jeff-skilling`** (stored slugs; `@` prefix is accepted in UI). Mail comes from the CMU Enron corpus—archive maildir users **`kean-s`**, **`lay-k`**, **`skilling-j`** map via manifests in [`eval/fixtures/enron-demo-registry.json`](../../eval/fixtures/enron-demo-registry.json). **`npm run brain:seed-enron-demo`** ingests all three under **`BRAIN_DATA_ROOT`**. That same seed supplies the **Kean** ripmail index used by **`npm run eval:run`** (default **`BRAIN_HOME`** = `./data/usr_enrondemo00000000001` when `BRAIN_DATA_ROOT=./data`). **`/demo`** picks a persona and shared secret — **Google OAuth–free** QA and automation.

Canonical ids + manifest filenames live in [`eval/fixtures/enron-demo-registry.json`](../../eval/fixtures/enron-demo-registry.json).

## Demo + LLM eval (same Kean mail tree)

**Hosted-style testing** (`/demo`, Bearer mint, Playwright) and **LLM JSONL evals** both read Kean’s indexed mail from **`$BRAIN_DATA_ROOT/usr_enrondemo00000000001`** — no separate `data-eval/brain`. Wiki JSONL cases still use isolated vaults under **`.data-eval/wiki-eval-cases/`**; JSON reports go to **`data-eval/eval-runs/`**. Details: [eval-home-and-mail-corpus.md](./eval-home-and-mail-corpus.md), [`eval/README.md`](../../eval/README.md).

| | **Demo (`/demo`, Playwright)** | **LLM eval (`eval:run`)** |
|---|-------------------------------|---------------------------|
| **Purpose** | Manual QA, browser automation | Harness Vitest + JSONL suites |
| **Mail index** | Per-persona tenant dirs under `$BRAIN_DATA_ROOT` | Same **Kean** tenant dir for mail tools (`usr_enrondemo00000000001`) |
| **Auth** | `BRAIN_ENRON_DEMO_SECRET` | N/A (offline agent tools) |

Tarball cache when downloading: **`./data/.cache/enron/`** (ignored with `./data/`).

## Playwright E2E (repo)

Automated browser/API tests live under [`tests/e2e/`](../../tests/e2e/). Run **`pnpm run dev`** on port **3000** against **`./data`**, run **`pnpm run brain:seed-enron-demo`** once, then **`pnpm run e2e:playwright`**. See [`tests/e2e/README.md`](../../tests/e2e/README.md).

## When it is available

| Requirement | Notes |
|-------------|--------|
| `BRAIN_DATA_ROOT` | Demo is **disabled** in single-tenant mode; `POST /api/auth/demo/enron` returns **501**. |
| `BRAIN_ENRON_DEMO_SECRET` | Any **non-empty** string after trimming. If unset or blank, demo **routes still exist** but handlers return **404** (`not_found`). There is no in-app link to `/demo`—operators share the URL directly. |
| `BRAIN_ENRON_DEMO_TENANT_ID` | Optional **operator lock**: when set, mint/seed only allowed for the registry user with this exact tenant id (must pass `isValidUserId`). Leave unset to allow all three demo personas. |

Inline placeholders: [`.env.example`](../../.env.example).

## Operator flows

### A. Browser (manual)

1. Deploy or run with the env vars above (e.g. `npm run docker:up` after copying `.env.example` → `.env`).
2. Open **`/demo`** directly (bookmark or typed URL).
3. Choose **Steven Kean**, **Kenneth Lay**, or **Jeff Skilling**, then paste the shared demo secret and submit. Mail must already exist under **`BRAIN_DATA_ROOT`** (operators run **`npm run brain:seed-enron-demo`** first). If not provisioned, mint returns **503** with instructions — there is no server-side first-hit ingest from `/demo`.
4. On **200**, the app sets a normal **`brain_session`** cookie for **that tenant** and redirects to `/c`.

### B. API (automation / Playwright)

Use the same Bearer secret as server env `BRAIN_ENRON_DEMO_SECRET`:

```ts
const demoUser = 'kean' // or 'lay' | 'skilling'
const res = await request.post(`${baseUrl}/api/auth/demo/enron`, {
  headers: {
    Authorization: `Bearer ${process.env.BRAIN_ENRON_DEMO_SECRET}`,
    'Content-Type': 'application/json',
  },
  data: JSON.stringify({ demoUser }),
})
// 503 → demo_not_seeded — run seed CLI for that persona under BRAIN_DATA_ROOT (see below), then POST again
// 200 → Set-Cookie: brain_session=…
```

Optional **`GET /api/auth/demo/enron/users`** returns `{ key, label }[]` for UI pickers (no Bearer; still requires demo secret to be configured server-side).

Poll **`GET /api/auth/demo/enron/seed-status?demoUser=…`** with the same `Authorization` header while an operator **`GET /api/auth/demo/enron/reseed`** rebuild is running (background ingest); normal mint does **not** start ingest.

### C. Pre-seed on disk (required before mint)

Build each tenant **before** Bearer mint or **`/demo`** — there is no lazy download from the mint handler.

**Local dev** (`npm run dev` already uses `./data`):

```sh
npm run brain:seed-enron-demo
# optional: npm run brain:seed-enron-demo -- --force
```

Single mailbox only:

```sh
export BRAIN_DATA_ROOT=./data
export BRAIN_ENRON_DEMO_USER=lay   # kean | lay | skilling
node scripts/brain/seed-enron-demo-tenant.mjs
```

Equivalent with an explicit root:

```sh
export BRAIN_DATA_ROOT=/path/to/multitenant-root   # e.g. ./data or /brain-data
# optional: export EVAL_ENRON_TAR=/path/to/enron_mail_20150507.tar.gz
node scripts/brain/seed-enron-demo-tenant.mjs --all
# one tenant: BRAIN_ENRON_DEMO_USER=kean node scripts/brain/seed-enron-demo-tenant.mjs
# optional: append --force
```

If `EVAL_ENRON_TAR` is unset, the script downloads the corpus into **`./data/.cache/enron/enron_mail_20150507.tar.gz`** when needed.

In **Docker**, the image includes **`/app/seed-enron/`** (manifest + ingest scripts only; **no** corpus). You can `docker exec` the same Node command with `BRAIN_DATA_ROOT` and `EVAL_ENRON_TAR` mounted or copied in. See [`Dockerfile`](../../Dockerfile).

**Operator reseed** (explicit): **`GET /api/auth/demo/enron/reseed`** with the same Bearer secret starts a background wipe+rebuild for one persona; poll **`seed-status`** until **`ready`**, then mint again. That path uses the same ingest resolution as the CLI (`BRAIN_SEED_REPO_ROOT`, **`cwd()/seed-enron`**, repo root, `EVAL_ENRON_TAR`, then manifest URL + SHA / `ENRON_SOURCE_URL`).

## Security

- Treat `BRAIN_ENRON_DEMO_SECRET` like **`BRAIN_EMBED_MASTER_KEY`**: long random value, never commit, rotate if leaked.
- Anyone with the secret obtains a **full session** for whichever demo tenant they mint into (workspace hijack of that fixture), not access to unrelated Google-signed-in tenants.
- Do not enable on public production without network controls unless the secret is strictly operator-only.

## Code map (final design)

| Piece | Role |
|--------|------|
| [`src/server/lib/auth/enronDemo.ts`](../../src/server/lib/auth/enronDemo.ts) | Secret length, Bearer check, path helpers for middleware |
| [`src/server/lib/auth/enronDemoSeed.ts`](../../src/server/lib/auth/enronDemoSeed.ts) | Operator **reseed** background job + status snapshot |
| [`src/server/routes/demoEnronAuth.ts`](../../src/server/routes/demoEnronAuth.ts) | `GET` users list, `POST` mint, `GET` seed-status / reseed |
| [`src/server/lib/vault/vaultGate.ts`](../../src/server/lib/vault/vaultGate.ts) / [`tenantMiddleware.ts`](../../src/server/lib/tenant/tenantMiddleware.ts) | Allow demo paths through gates; **handler** enforces secret |
| [`scripts/brain/seed-enron-demo-tenant.mjs`](../../scripts/brain/seed-enron-demo-tenant.mjs) | CLI + child-process ingest |
| [`scripts/eval/enronKeanIngest.mjs`](../../scripts/eval/enronKeanIngest.mjs) | Shared extract + ripmail index with eval |

## Local Docker image

[`docker-compose.yml`](../../docker-compose.yml): one `brain` service; **`BRAIN_DOCKER_PLATFORM=linux/amd64`** may be needed on Apple Silicon if the bundled `ripmail` ELF does not match the container arch (see `.env.example`).

## Related

- Opportunity spec + later phases (E2E tests, CI artifact): [archived OPP-051](../opportunities/archive/OPP-051-enron-corpus-e2e-and-cloud-testing.md)
- Eval home + corpus pipeline: [eval-home-and-mail-corpus.md](./eval-home-and-mail-corpus.md), [eval/README.md](../../eval/README.md)

---

*Back: [architecture README](./README.md)*
