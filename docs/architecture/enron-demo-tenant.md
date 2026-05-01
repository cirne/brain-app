# Enron demo tenant (hosted testing)

**OPP-051 Phase 0.** Multi-tenant deployments (`BRAIN_DATA_ROOT` set) can expose a **fixed** demo workspace backed by the public Enron `kean-s` mailbox (same ingest pipeline as `npm run eval:build`). This gives **Google OAuth–free** sessions for manual QA, staging, Docker, and automation—without weakening vault or tenant middleware globally.

## When it is available

| Requirement | Notes |
|-------------|--------|
| `BRAIN_DATA_ROOT` | Demo is **disabled** in single-tenant mode; `POST /api/auth/demo/enron` returns **501**. |
| `BRAIN_ENRON_DEMO_SECRET` | Any **non-empty** string after trimming. If unset or blank, demo **routes still exist** but handlers return **404** (`not_found`). There is no in-app link to `/demo`—operators share the URL directly. |
| `BRAIN_ENRON_DEMO_TENANT_ID` | Optional. Default: `usr_enrondemo00000000001` (must pass `isValidUserId`). |

Inline placeholders: [`.env.example`](../../.env.example).

## Operator flows

### A. Browser (manual)

1. Deploy or run with the env vars above (e.g. `npm run docker:up` after copying `.env.example` → `.env`).
2. Open **`/demo`** directly (bookmark or typed URL).
3. Paste the demo secret; submit. First visit may **202** while data is provisioned; the UI polls **`GET /api/auth/demo/enron/seed-status`** every few seconds.
4. On **200**, the app sets a normal **`brain_session`** cookie and redirects to `/`.

### B. API (automation / Playwright)

Use the same Bearer secret as server env `BRAIN_ENRON_DEMO_SECRET`:

```ts
// Example: mint session, then reuse cookie in browser context
const res = await request.post(`${baseUrl}/api/auth/demo/enron`, {
  headers: { Authorization: `Bearer ${process.env.BRAIN_ENRON_DEMO_SECRET}` },
})
// 202 → seeding; poll GET /api/auth/demo/enron/seed-status with same Authorization until seed.status === 'ready', then POST again
// 200 → Set-Cookie: brain_session=…
const cookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')
```

Poll **`GET /api/auth/demo/enron/seed-status`** with the same `Authorization` header while seeding.

### C. Pre-seed on disk (fast first login)

Avoid first-hit download + ingest (15–40+ minutes) by building the tenant **before** first browser visit:

```sh
export BRAIN_DATA_ROOT=/path/to/multitenant-root   # e.g. ./data or /brain-data
# optional: export EVAL_ENRON_TAR=/path/to/enron_mail_20150507.tar.gz  (skip auto-download)
npm run brain:seed-enron-demo
# optional: npm run brain:seed-enron-demo -- --force
```

If `EVAL_ENRON_TAR` is unset, the script downloads the corpus (same URL + SHA as `npm run eval:build`) into **`data-eval/.cache/enron/enron_mail_20150507.tar.gz`** when needed.

In **Docker**, the image includes **`/app/seed-enron/`** (manifest + ingest scripts only; **no** corpus). You can `docker exec` the same Node command with `BRAIN_DATA_ROOT` and `EVAL_ENRON_TAR` mounted or copied in. See [`Dockerfile`](../../Dockerfile).

**Lazy seed** (no pre-seed): the server runs that script in a background child process; it resolves repo root from `BRAIN_SEED_REPO_ROOT`, **`cwd()/seed-enron`** (container), or repo root, then uses `EVAL_ENRON_TAR` if set, otherwise prefers **`data-eval/.cache/enron/enron_mail_20150507.tar.gz`** (same as local `npm run eval:build`), then falls back to downloading the tarball URL + SHA from `eval/fixtures/enron-kean-manifest.json` (overridable with `ENRON_SOURCE_URL` / `ENRON_SHA256` for air-gapped mirrors).

## Security

- Treat `BRAIN_ENRON_DEMO_SECRET` like **`BRAIN_EMBED_MASTER_KEY`**: long random value, never commit, rotate if leaked.
- Anyone with the secret obtains a **full session** for the demo tenant (workspace hijack of that fixture), not access to other tenants.
- Do not enable on public production without network controls unless the secret is strictly operator-only.

## Code map (final design)

| Piece | Role |
|--------|------|
| [`src/server/lib/auth/enronDemo.ts`](../../src/server/lib/auth/enronDemo.ts) | Secret length, Bearer check, path helpers for middleware |
| [`src/server/lib/auth/enronDemoSeed.ts`](../../src/server/lib/auth/enronDemoSeed.ts) | Lazy background seed + status snapshot |
| [`src/server/routes/demoEnronAuth.ts`](../../src/server/routes/demoEnronAuth.ts) | `POST` mint, `GET` seed-status |
| [`src/server/lib/vault/vaultGate.ts`](../../src/server/lib/vault/vaultGate.ts) / [`tenantMiddleware.ts`](../../src/server/lib/tenant/tenantMiddleware.ts) | Allow demo paths through gates; **handler** enforces secret |
| [`scripts/brain/seed-enron-demo-tenant.mjs`](../../scripts/brain/seed-enron-demo-tenant.mjs) | CLI + child-process ingest |
| [`scripts/eval/enronKeanIngest.mjs`](../../scripts/eval/enronKeanIngest.mjs) | Shared extract + ripmail index with eval |

## Local Docker image

[`docker-compose.yml`](../../docker-compose.yml): one `brain` service; **`BRAIN_DOCKER_PLATFORM=linux/amd64`** may be needed on Apple Silicon if the bundled `ripmail` ELF does not match the container arch (see `.env.example`).

## Related

- Opportunity spec + later phases (E2E tests, CI artifact): [OPP-051](../opportunities/OPP-051-enron-corpus-e2e-and-cloud-testing.md)
- Eval home + corpus pipeline: [eval-home-and-mail-corpus.md](./eval-home-and-mail-corpus.md), [eval/README.md](../../eval/README.md)

---

*Back: [architecture README](./README.md)*
