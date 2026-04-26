# OPP-051: Enron Corpus — E2E Testing and Cloud Agent Fixtures

**Problem:** The ~25k Enron `kean-s` mailbox is used exclusively for **model eval benchmarks** (`npm run eval:run:enron`). This realistic corpus is underutilized—current unit/integration tests rely on tiny inline fixtures or mocked ripmail, missing FTS5 edge cases, large-index behavior, and real-world threading/attachment scenarios. Cloud agents (Cursor Cloud, staging) cannot run email tests at all without the corpus.

**Direction:** Expand Enron usage to:
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

**Gap:** No non-LLM automated tests exercise the Enron index. Cloud agents have no access path.

---

## Proposed Work

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

- [eval/README.md](../../eval/README.md) — current eval harness docs
- [ripmail OPP-026](../../ripmail/docs/opportunities/OPP-026-realistic-imap-test-corpus-and-timestamp-shift.md) — Docker IMAP + timestamp shift (ripmail-side)
- [docs/architecture/eval-home-and-mail-corpus.md](../architecture/eval-home-and-mail-corpus.md) — eval home layout
- [CLOUD-AGENTS.md](../../CLOUD-AGENTS.md) — cloud agent setup

---

## Notes

- **PII:** Enron is a public research corpus. Do not commit raw mail; keep extracted material under gitignored `data-eval/`.
- **Size tradeoff:** Full maildir is ~500 MB; SQLite index is ~50 MB. Consider shipping index-only artifact if maildir not needed for tests.
- **No backward compat:** Per [AGENTS.md](../../AGENTS.md), no migration scripts. Stamp invalidation rebuilds cleanly.
