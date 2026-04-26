# OPP-051: Enron Corpus — E2E Testing and Cloud Agent Fixtures

**Problem:** The ~25k Enron `kean-s` mailbox is used exclusively for **model eval benchmarks** (`npm run eval:run:enron`). This realistic corpus is underutilized—current unit/integration tests rely on tiny inline fixtures or mocked ripmail, missing FTS5 edge cases, large-index behavior, and real-world threading/attachment scenarios. Cloud agents (Cursor Cloud, staging) cannot run email tests at all without the corpus.

**Direction:** Expand Enron usage to:
0. **Demo / fixture tenant** — Bake at least one Enron mailbox (+ wiki) into deployable images or volumes; **secret-gated session** minting so browsers, Playwright, and humans can use the full app **without Google OAuth**
1. **Deterministic E2E tests** (no LLM) against the real index
2. **CI artifact** for pre-built `ripmail.db` so cloud agents can download and test
3. **Optional timestamp-shift** so "recent mail" queries work on the 1999–2002 corpus

---

## Current State

| Component | Location | Purpose |
|-----------|----------|---------|
| Manifest | `eval/fixtures/enron-kean-manifest.json` | CMU tarball pointer, SHA-256, user `kean-s` |
| Build script | `scripts/eval/build-enron-kean.mjs` | Extract → `data-eval/brain/ripmail/` |
| Task file | `eval/tasks/enron-v1.jsonl` | 16 agent prompts + expectations (LLM eval) |
| Output | `data-eval/eval-runs/*.json` | Per-model pass rate, tokens, cost |

**Gap:** No non-LLM automated tests exercise the Enron index. Cloud agents have no access path. Hosted flows assume **Google OAuth** for tenant binding, so demos and browser automation cannot yet impersonate a realistic mail+wiki user without OAuth.

---

## Proposed Work

### Phase 0: Enron demo tenant + non-OAuth session (first milestone)

**Goal:** A running deployment (Docker / staging slice) can ship with **one fixed Enron-backed tenant** (`ripmail.db` + optional seed wiki). Callers obtain a normal `brain_session` cookie **without Google** via a **single, explicit API**, so inbox, chat, and wiki paths behave like a real signed-in user.

**Tenant directory name:** Must match real tenant ids: `usr_` + **20** lowercase alphanumeric characters (see `USER_ID_PREFIX` / `USER_ID_RANDOM_LEN` in `src/server/lib/tenant/handleMeta.ts`). Example placeholder: `usr_enrondemo00000000001` — pick one fixed id, document it, and use it everywhere (registry seed, Docker COPY path, env override).

**Why not “bypass auth” globally:** `vaultGateMiddleware` and `tenantMiddleware` should stay strict. The demo path should mirror the OAuth callback: `createVaultSession()` + `registerSessionTenant(sessionId, tenantUserId)` + `setBrainSessionCookie` (see `src/server/routes/gmailOAuth.ts`). That reuses existing tenant home resolution (`ripmailHomeForBrain`, wiki under the same `BRAIN_DATA_ROOT/<usr_…>/` tree).

#### Implementation plan (ordered)

1. **Stable tenant id and on-disk layout**
   - Choose a fixed `tenantUserId` (e.g. `usr_enrondemo00000000001`; must pass `isValidUserId()`).
   - Under `BRAIN_DATA_ROOT/<tenantUserId>/`, ensure full [brain layout](../../shared/brain-layout.json): `ripmail/`, `wiki/`, vault verifier if MT vault is required for product feedback routes, etc.
   - Populate `ripmail/` using the same pipeline as eval: [eval/fixtures/enron-kean-manifest.json](../../eval/fixtures/enron-kean-manifest.json) → `scripts/eval/build-enron-kean.mjs` output shape (synthetic `mailboxId` / `accountEmail`; local `.eml` + SQLite — **no Gmail tokens**).

2. **Seed data beside the image (CLI), not inside it**
   - **CLI:** [`scripts/brain/seed-enron-demo-tenant.mjs`](../../scripts/brain/seed-enron-demo-tenant.mjs) + `npm run brain:seed-enron-demo` — requires `BRAIN_DATA_ROOT`, `EVAL_ENRON_TAR`, optional `--force`. Writes `$BRAIN_DATA_ROOT/<tenantId>/` with the same ingest pipeline as eval ([`scripts/eval/enronKeanIngest.mjs`](../../scripts/eval/enronKeanIngest.mjs)).
   - **Host:** Run from repo with `BRAIN_DATA_ROOT=./data-multitenant` (or any path), or bind-mount that path into a container.
   - **Docker / runtime:** No separate compose seed service. The first successful **`POST /api/auth/demo/enron`** (Bearer secret) or browser flow at **`/demo`** starts a **lazy background seed** when `ripmail/ripmail.db` is missing or empty (download + ingest; can take 15–40+ minutes). Poll **`GET /api/auth/demo/enron/seed-status`** with the same bearer. Set **`EVAL_ENRON_TAR`** in the environment to skip downloading the CMU tarball. See [`docker-compose.yml`](../../docker-compose.yml) (single `brain` service).
   - **Reset:** `--force` removes the tenant directory under `BRAIN_DATA_ROOT` and rebuilds from the tarball.

3. **Environment flags and secrets**
   - `BRAIN_ENRON_DEMO_SECRET` — any non-empty string (e.g. a shared demo password for prospects). When unset or blank, demo routes return **404** from the handler (no separate `BRAIN_ENRON_DEMO` flag). Request must present it (e.g. `Authorization: Bearer <secret>`). Same operational class as `BRAIN_EMBED_MASTER_KEY` (never commit; rotate if leaked).
   - Optional: `BRAIN_ENRON_DEMO_TENANT_ID` override for tests (default `usr_enrondemo00000000001`).

4. **Routes: mint demo session + lazy seed**
   - `POST /api/auth/demo/enron` in `src/server/routes/demoEnronAuth.ts`:
     - If `!isMultiTenantMode()`, return **501** (MT path first for Docker/staging).
     - Validate bearer secret (`timingSafeEqual`-style; see `enronDemo.ts`).
     - If the demo tenant is not seeded yet (`ripmail.db` missing/empty), start background ingest and return **202** with a seed snapshot; when ready, the same POST completes mint.
     - On success: `createVaultSession()`, `registerSessionTenant`, `setBrainSessionCookie`, **`200`** + `{ ok: true }`.
   - `GET /api/auth/demo/enron/seed-status` — same bearer; returns `{ seed: { status: … } }` for UI polling (e.g. every 5s on `/demo`).
   - Extend `allowNoTenantContextMt` and `vaultGate.ts` for **`POST /api/auth/demo/enron`** and **`GET /api/auth/demo/enron/seed-status`** (`isEnronDemoPublicApiPath`) so unconfigured demo (no valid secret in env) still returns **404** from the handler.

5. **Tests (TDD)**
   - `src/server/routes/demoEnronAuth.test.ts` (or similar): with `BRAIN_DATA_ROOT` temp dir, pre-seed minimal tenant tree, set `BRAIN_ENRON_DEMO_SECRET`, POST with good secret → cookie set + subsequent `GET /api/…` sees tenant context; bad secret → 401; secret not configured → 404.
   - No Playwright in repo requirement for Phase 0 closure; document the Playwright recipe below for milestone follow-through.

6. **Playwright / browser automation (documentation + optional scaffold)**
   - One `request` call to `POST /api/auth/demo/enron` with bearer secret; capture `Set-Cookie`; on **202**, poll `GET /api/auth/demo/enron/seed-status` until ready, then POST again.
   - Save `storageState` and reuse for inbox + wiki specs.
   - **Documented:** [enron-demo-tenant.md](../architecture/enron-demo-tenant.md) (cross-links: [eval-home-and-mail-corpus.md](../architecture/eval-home-and-mail-corpus.md), [eval/README.md](../../eval/README.md)).

7. **Security and deployment**
   - Do **not** set `BRAIN_ENRON_DEMO_SECRET` on public production without network controls unless the secret is treated as an operator credential.
   - Enron mail is a **public research corpus**; risk is **workspace hijack** (demo tenant), not corpus PII.
   - Staging: optional IP allowlist or separate hostname (`demo.staging…`) later; out of scope for minimal Phase 0.

8. **Relation to later phases**
   - Phase 2’s `enron-kean-eval-*.tar.gz` artifact can be unpacked under `BRAIN_DATA_ROOT/<tenantId>/` or fed as `EVAL_ENRON_TAR` via the same seed CLI.
   - Phase 1 Vitest can run against `data-eval/` or against the demo tenant path in CI when the artifact is unpacked.

#### Single-tenant alternative (local dev only)

If the milestone is **only** `BRAIN_HOME` (no `BRAIN_DATA_ROOT`): bake Enron under `$BRAIN_HOME/ripmail`, run one-time vault setup with password from `BRAIN_DEMO_VAULT_PASSWORD`, document unlock for demos. This avoids new routes but **does not** match hosted MT behavior — use MT + demo session if Playwright must mirror staging.

---

### Phase 1: Deterministic E2E Tests (no LLM)

Add `npm run test:e2e:enron` that requires `data-eval/brain/ripmail/ripmail.db` and runs vitest cases against the real index.

**Test coverage:**
- `ripmail search` — FTS5 queries: exact phrase, `from:`, `to:`, date ranges, edge cases
- `ripmail read` — known message IDs → assert body extraction, headers, threading
- `ripmail who` — contact graph against known senders (verify counts, display names)
- `ripmail attachment list/read` — Enron has PDFs; verify extraction pipeline
- `ripmail inbox` with `rules.json` defaults — deterministic classification on historical mail

**Example test structure:**

```typescript
// src/server/evals/e2e/enronRipmail.test.ts
describe('enron corpus e2e', () => {
  beforeAll(() => {
    // skip gracefully if data-eval not built
  });

  it('search from:kean returns results', async () => { ... });
  it('read known message extracts body', async () => { ... });
  it('who top contacts includes expected names', async () => { ... });
});
```

**Skip logic:** Tests skip (not fail) when `data-eval/brain/ripmail/ripmail.db` is missing. Developers run `npm run eval:build` first; CI caches the artifact.

### Phase 2: CI Artifact for Cloud Agents

Publish pre-built `ripmail.db` (+ minimal maildir if needed) as a GitHub Release asset.

**CI workflow:**
1. On `main` push (or weekly schedule), run `npm run eval:build`
2. Upload `data-eval/brain/ripmail/` as `enron-kean-eval-<sha>.tar.gz` to `eval-fixtures` release
3. Cloud agents download + extract before running email-related work

**CLOUD-AGENTS.md addition:**

```bash
# Optional: Download Enron eval fixtures for email testing
gh release download eval-fixtures --pattern 'enron-kean-eval-*.tar.gz'
tar -xzf enron-kean-eval-*.tar.gz -C data-eval/
# Now npm run test:e2e:enron works
```

**Size estimate:** ~50–100 MB for `ripmail.db` + compressed `.eml` stubs (full maildir is larger; we may strip bodies for the artifact if only FTS is needed).

### Phase 3: Timestamp Shift (Optional)

Per [ripmail OPP-026](../../ripmail/docs/opportunities/OPP-026-realistic-imap-test-corpus-and-timestamp-shift.md), Enron dates are 1999–2002. Add a build flag:

```bash
npm run eval:build -- --shift-to-now
```

Behavior:
- Compute `delta = now - max(date)` across all messages
- Apply `delta` to indexed `date` column at ingest (raw `.eml` unchanged)
- Store `adjusted_date` or flag so queries like `inbox 7d` return results

**Use cases:**
- `ripmail inbox <window>` returns non-empty results
- Sliding-window refresh tests behave like production
- Agent tools with implicit recency assumptions work

### Phase 4: Multi-User Extraction (Future)

Extract additional Enron users for multi-tenant isolation testing:

```json
{
  "users": [
    { "sourceUser": "kean-s", "accountEmail": "kean@enron.fixture" },
    { "sourceUser": "lay-k", "accountEmail": "lay@enron.fixture" },
    { "sourceUser": "skilling-j", "accountEmail": "skilling@enron.fixture" }
  ]
}
```

Each user gets a separate `RIPMAIL_HOME` under `data-eval/`. Tests verify:
- User A cannot search User B's mail
- `search_index` tool respects session boundaries
- Hosted multi-tenant isolation holds

---

## Acceptance Criteria

### Phase 0 (demo tenant + non-OAuth session)
- [x] Fixed tenant directory (valid `usr_` + 20 chars, e.g. `usr_enrondemo00000000001`) documented; populated with Enron `kean-s` ripmail index (same synthetic account as eval manifest) — operator guide: [enron-demo-tenant.md](../architecture/enron-demo-tenant.md)
- [x] `BRAIN_ENRON_DEMO_SECRET` documented in `.env.example` (placeholder only) and deployment notes
- [x] `POST /api/auth/demo/enron` mints `brain_session` bound to the demo tenant when bearer secret matches; demo not configured (no/short secret) → 404; single-tenant → 501
- [x] `tenantMiddleware` / `vaultGate` allow the mint path always; **handler** enforces secret + bearer (no broad API bypass)
- [x] Vitest coverage for happy path + rejected secret + demo off + misconfiguration (`src/server/routes/demoEnronAuth.test.ts`, `src/server/lib/auth/enronDemo.test.ts`)
- [x] **Seed CLI** — `npm run brain:seed-enron-demo` / `scripts/brain/seed-enron-demo-tenant.mjs`; Docker runtime ships `/app/seed-enron/` (no corpus in image). See `.env.example` and `docker-compose.yml` comments.
- [ ] Optional wiki reset procedure for long-lived demo deployments (cron / replace volume) noted separately
- [x] Short Playwright recipe documented (Bearer + `POST /api/auth/demo/enron`; poll seed-status) — [enron-demo-tenant.md](../architecture/enron-demo-tenant.md)

### Phase 1 (MVP)
- [ ] `npm run test:e2e:enron` runs vitest against `data-eval/brain/ripmail/ripmail.db`
- [ ] At least 5 test cases covering search, read, who, attachment
- [ ] Tests skip gracefully when corpus not built (no CI failure on fresh clone)
- [ ] Document in `eval/README.md`

### Phase 2
- [ ] CI workflow publishes `enron-kean-eval-*.tar.gz` to GitHub Releases
- [ ] `CLOUD-AGENTS.md` documents download + setup
- [ ] Cloud agent can run `test:e2e:enron` after downloading artifact

### Phase 3
- [ ] `--shift-to-now` flag on `eval:build` shifts indexed dates
- [ ] `ripmail inbox 7d` returns results on shifted corpus
- [ ] Stamp includes shift anchor for reproducibility

### Phase 4
- [ ] Multi-user manifest extracts 2+ Enron users
- [ ] Isolation tests verify cross-user search protection

---

## Related

- [docs/architecture/enron-demo-tenant.md](../architecture/enron-demo-tenant.md) — **operator runbook** (staging, Docker, automation)
- [eval/README.md](../../eval/README.md) — current eval harness docs
- [ripmail OPP-026](../../ripmail/docs/opportunities/OPP-026-realistic-imap-test-corpus-and-timestamp-shift.md) — Docker IMAP + timestamp shift (ripmail-side)
- [docs/architecture/eval-home-and-mail-corpus.md](../architecture/eval-home-and-mail-corpus.md) — eval home layout
- [CLOUD-AGENTS.md](../../CLOUD-AGENTS.md) — cloud agent setup

---

## Notes

- **PII:** Enron is a public research corpus. Do not commit raw mail; keep extracted material under gitignored `data-eval/`.
- **Size tradeoff:** Full maildir is ~500 MB; SQLite index is ~50 MB. Consider shipping index-only artifact if maildir not needed for tests.
- **No backward compat:** Per [AGENTS.md](../../AGENTS.md), no migration scripts. Stamp invalidation rebuilds cleanly.
