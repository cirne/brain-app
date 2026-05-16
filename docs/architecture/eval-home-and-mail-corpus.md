# Eval harness and fixture mail corpora

**Status:** Living document.

> **Scope:** LLM evals share **`BRAIN_HOME`** with local multi-tenant dev: **`./data/usr_enrondemo00000000001`** (Kean demo tenant) when **`BRAIN_DATA_ROOT=./data`** and `BRAIN_HOME` is unset—same ripmail tree as `/demo` “kean”. Wiki JSONL cases use isolated vault parents under **`.data-eval/wiki-eval-cases/`**. See [enron-demo-tenant.md](./enron-demo-tenant.md) for Bearer `/demo` flows.

**How-to:** [`../../eval/README.md`](../../eval/README.md).

---

## Why this exists

Integration evals need a **production-shaped** [`$BRAIN_HOME`](./data-and-sync.md): `ripmail/`, `wiki/`, etc. ([`shared/brain-layout.json`](../../shared/brain-layout.json)). Mail-backed runs use the **Kean** tenant directory under **`BRAIN_DATA_ROOT`** so operators **seed once** (`pnpm run brain:seed-enron-demo`) for demo + benchmarks.

---

## Naming

| Term | Meaning |
|------|---------|
| **Default eval brain** | Kean tenant: **`$BRAIN_DATA_ROOT/usr_enrondemo00000000001`** (see [`eval/fixtures/enron-demo-registry.json`](../../eval/fixtures/enron-demo-registry.json)). |
| **`./data/.cache/enron/`** | Stable CMU tarball cache (`enron_mail_20150507.tar.gz`), gitignored via **`./data/`**. |
| **`data-eval/eval-runs/`** | JSON reports from JSONL suites (gitignored). |
| **`.data-eval/wiki-eval-cases/`** | Per–wiki-case vault roots (`BRAIN_WIKI_ROOT`), gitignored. |
| **Synthetic account** | ripmail `config.json` may list an IMAP-shaped identity; **no live IMAP** for fixtures. |

---

## Layout (on disk)

```
.data-eval/
  wiki-eval-cases/<task-id>/wiki/   # wiki JSONL isolated vaults

data-eval/eval-runs/                # JSONL suite reports (gitignored)

data/
  .cache/enron/enron_mail_20150507.tar.gz   # verified tarball cache
  usr_enrondemo00000000001/        # Kean — default BRAIN_HOME for eval JSONL
    ripmail/
    wiki/
    chats/
    var/
      brain-tenant.sqlite
    ...
  usr_enrondemo00000000002/        # Lay (demo)
  usr_enrondemo00000000003/        # Skilling (demo)
```

**Committed:** [`eval/fixtures/`](../../eval/fixtures/), [`eval/tasks/`](../../eval/tasks/), [`scripts/eval/`](../../scripts/eval/) ingest helpers.

---

## Ripmail constraints (critical for corpora)

- **Maildir → SQLite** rebuild uses the TypeScript pipeline ([`rebuildFromMaildir.ts`](../../src/server/ripmail/rebuildFromMaildir.ts)); date normalization lives in [`ingestDate`](../../src/server/ripmail/sync/ingestDate.ts) and related ingest helpers — same role as the old `rebuild-index` / maildir import CLI conceptually.
- Only **`.eml`** files are indexed as messages from maildir trees (see rebuild logic in `rebuildFromMaildir`).
- Multi-mailbox layout: `<mailbox_id>/maildir/...` under each tenant `ripmail/` home; SQLite at `ripmail.db`.

---

## Enron `kean-s` pipeline

**Automation:** **`pnpm run brain:seed-enron-demo`** runs [`scripts/brain/seed-enron-demo-tenant.mjs`](../../scripts/brain/seed-enron-demo-tenant.mjs) for **all registry users**, using [`scripts/eval/enronKeanIngest.mjs`](../../scripts/eval/enronKeanIngest.mjs) + [`scripts/eval/ensureEnronTarball.mjs`](../../scripts/eval/ensureEnronTarball.mjs). Tarball: **`EVAL_ENRON_TAR`** or download into **`./data/.cache/enron/`** with SHA verify (`ENRON_SOURCE_URL` / `ENRON_SHA256` overrides).

**Source:** [CMU Enron](https://www.cs.cmu.edu/~enron/). Archive contains **`maildir/<user>/…`**; ingest extracts one user per manifest, flattens to **`cur/*.eml`**, then indexes via the in-repo **`src/server/ripmail/`** maildir import path (same outcome as the legacy standalone **`rebuild-index`** workflow).

**Dates:** late 1990s–early 2000s — use **absolute ranges** or **`EVAL_ASSISTANT_NOW`** / harness defaults in JSONL evals.

---

## Idempotency

Re-running **`pnpm run brain:seed-enron-demo`** skips tenants that already have a non-empty **`ripmail.db`** unless **`--force`** removes and rebuilds.

---

## Test harness (Vitest)

- **`vitest.config.ts`** excludes `src/server/evals/**` from default **`pnpm run test`**.
- **`pnpm run eval:run`:** Vitest (**`vitest.eval.config.ts`**) then JSONL suites via [`scripts/eval-run.mjs`](../../scripts/eval-run.mjs); sets **`BRAIN_DATA_ROOT=./data`**.

---

## What to update when you change the system

| Change | Update |
|--------|--------|
| New corpus / manifest | [`eval/fixtures/`](../../eval/fixtures/) + this doc + [`eval/README.md`](../../eval/README.md) |
| Paths / pnpm scripts | [`package.json`](../../package.json) + [`eval/README.md`](../../eval/README.md) |
| Ripmail indexing rules | This doc + ripmail sources if behavior changes |
| Eval strategy | [`wiki-and-agent-evaluation.md`](../wiki-and-agent-evaluation.md) |

---

*Next: [integrations.md](./integrations.md) · [data-and-sync.md](./data-and-sync.md)*
