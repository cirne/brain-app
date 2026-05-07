# Eval home and fixture mail corpora

**Status:** Living document — update as eval tooling, corpora, or ripmail indexing rules change.

> **Scope:** This document describes the **LLM / harness eval home** (`./data-eval/brain`, `BRAIN_HOME` for `npm run eval:run`). For **user testing and browser automation** against Enron inside normal multi-tenant storage (`$BRAIN_DATA_ROOT`), Bearer mint, and `/demo`, see [enron-demo-tenant.md](./enron-demo-tenant.md) and [`tests/e2e/README.md`](../../tests/e2e/README.md).

**User-facing how-to:** [`../../eval/README.md`](../../eval/README.md) (commands, env vars).  
**Broader eval research:** [`../wiki-and-agent-evaluation.md`](../wiki-and-agent-evaluation.md).

---

## Why this exists

Integration and agent evals need a **fixed on-disk profile** that mirrors production: [`$BRAIN_HOME`](./data-and-sync.md) with `ripmail/`, `wiki/`, `chats/`, etc. ([`shared/brain-layout.json`](../../shared/brain-layout.json)). We use a dedicated **eval home** under a gitignored tree so tests do not touch dev `data/` and the large mail cache is never committed.

---

## Naming

| Term | Meaning |
|------|---------|
| **Eval home** | The `BRAIN_HOME` directory used for evals. In-repo convention: **`./data-eval/brain`** (set `BRAIN_HOME` for Vitest and local runs). |
| **`data-eval/`** | Repo-root directory (sibling to `data/`) for **all generated** eval material: download cache, stamp, and `brain/`. Listed in [`.gitignore`](../../.gitignore). |
| **`.data-eval/`** | Repo-root directory for **per–wiki-case** vault parents from JSONL wiki evals: `.data-eval/wiki-eval-cases/<task-id>/` (`BRAIN_WIKI_ROOT`), reset at case start, retained after the run. Listed in [`.gitignore`](../../.gitignore). |
| **Eval corpus / fixture mail** | Indexed messages backing the suite — **describes content**, not directory names. Avoid “Enron mailbox” as a path name; prefer **eval home** + manifest field for source. |
| **Synthetic account** | `config.json` may list a normal IMAP identity (e.g. a Gmail-shaped address) for ripmail; **no live IMAP** is required for local index-only fixtures. |

---

## Layout (on disk)

```
.data-eval/                         # gitignored — wiki JSONL isolated vaults (not BRAIN_HOME)
  wiki-eval-cases/                  # per JSONL `id`: <id>/wiki/…
    <task-id>/
      wiki/

data-eval/                          # gitignored
  .cache/                           # Enron tarball extract cache (`enron/expand/…`)
  .enron-kean-stamp.json            # invalidation (manifest hash, ripmail version, source user, …)
  brain/                            # BRAIN_HOME for eval
    ripmail/                        # RIPMAIL_HOME (default; see integrations)
      config.json
      .env                          # placeholder secrets for config load
      <mailbox_id>/
        .env
        maildir/cur/*.eml           # messages indexed by rebuild-index
      ripmail.db
    wiki/
    chats/
    cache/
    var/
```

**Committed** beside this tree: [`eval/fixtures/`](../../eval/fixtures/) (manifests with URL + SHA-256), [`eval/tasks/`](../../eval/tasks/) (future JSONL tasks), [`scripts/eval/`](../../scripts/eval/) (build pipeline).

---

## Ripmail constraints (critical for corpora)

- **Index build:** `ripmail rebuild-index` walks the configured **maildir root** and imports messages for [`rebuild_from_maildir`](../../ripmail/src/rebuild_index.rs). Untrustworthy index dates (before 1990-01-01 UTC or unparseable) are normalized to the minimum trustworthy date in that batch, or skipped with a stderr warning — see [`ingest_date`](../../ripmail/src/sync/ingest_date.rs) and [`eval/README.md`](../../eval/README.md) (`ripmail status` section).
- **File pick rule:** the walker only considers files whose extension is **`.eml`**. See `collect_eml_paths` in [`rebuild_index.rs`](../../ripmail/src/rebuild_index.rs). Anything else (e.g. extensionless `12.`) is **not** indexed.
- **Multi-inbox layout:** under `RIPMAIL_HOME`, mail lives at `<mailbox_id>/maildir/...` where `mailbox_id` is derived from the configured email (e.g. `user_gmail_com`). See config resolution in [`config.rs`](../../ripmail/src/config.rs).
- **Database:** multi-mailbox homes use `RIPMAIL_HOME/ripmail.db` (see `load_config` in ripmail `config.rs`).

**Implication:** every fixture pipeline must end with one **`.eml` per message** under the expected maildir tree, or **ripmail must be extended** to accept additional on-disk shapes (a broader product change).

---

## Enron `kean-s` fixture (primary pipeline)

**Automation:** [`npm run eval:build`](../../package.json) runs [`scripts/eval/build-enron-kean.mjs`](../../scripts/eval/build-enron-kean.mjs), which reads [`eval/fixtures/enron-kean-manifest.json`](../../eval/fixtures/enron-kean-manifest.json). If `EVAL_ENRON_TAR` is unset, it **downloads** the tarball once (URL + SHA from the manifest; overridable with `ENRON_SOURCE_URL` / `ENRON_SHA256`) into **`data-eval/.cache/enron/enron_mail_20150507.tar.gz`**, then verifies SHA-256, selectively extracts **`maildir/kean-s/`**, copies every message file into **`cur/*.eml`**, writes ripmail `config.json` + env, runs **`ripmail rebuild-index`**, and writes **`data-eval/.enron-kean-stamp.json`**.

**Source:** [CMU Enron `enron_mail_20150507.tar.gz`](https://www.cs.cmu.edu/~enron/) (and mirrors). The archive unpacks to **`maildir/<user>/…`** for many users; the eval script extracts **one** user subtree only.

**On-disk shape inside the tarball:**

- Folders are named like IMAP mailboxes (e.g. `inbox`, `notes_inbox`).
- Message files are typically named `1.`, `22.` (numeric + dot) — **no `.eml` extension**.

**Why flatten + rename:** ripmail’s maildir walker only indexes **`.eml`** files (see **Ripmail constraints** above). The build script copies each file to `cur/0000001.eml`, etc.

**Scale:** on the order of **tens of thousands** of messages for `kean-s` — suitable for load and recall-at-scale agent evals (see [`eval/README.md`](../../eval/README.md)).

**Dates:** message dates are **late 1990s–early 2000s**. Eval tasks that use **relative** windows (“yesterday”, “last week”) or default short search windows will often see **no hits** unless the harness uses **absolute ranges**, **date-shifting** at import time, or a **test-only “eval clock”** (see [wiki-and-agent-evaluation.md](../wiki-and-agent-evaluation.md) and [`eval/README.md`](../../eval/README.md)).

**Licensing / ethics:** use the dataset per CMU/hosts’ terms; do not commit raw corpora into git.

**Adding another Enron user:** add a manifest + script modeled on `enron-kean-manifest.json` / `build-enron-kean.mjs` (archive hash, `pathInsideArchive`, synthetic `mailboxId` / `accountEmail`, stamp fields).

---

## Invalidation (stamp)

The Enron eval build writes **`data-eval/.enron-kean-stamp.json`** so repeat runs skip extract + reindex when nothing material changed. Typical fields (see [`scripts/eval/build-enron-kean.mjs`](../../scripts/eval/build-enron-kean.mjs)):

- **`manifestExpectedSha256`:** expected **SHA-256** of the Enron `tar.gz`.
- **`ripmailVersion`:** first line of `ripmail --version` from the binary used (see [`scripts/eval/ripmailBin.mjs`](../../scripts/eval/ripmailBin.mjs)).
- **`sourceUser`:** mailbox id inside the archive (e.g. `kean-s`).
- **`fileCount`:** messages copied into `cur/`.

Rebuild when ripmail **schema** or **index rules** change incompatibly (see ripmail `open_file` / migrations in [`db/mod.rs`](../../ripmail/src/db/mod.rs)).

CI should **cache** `data-eval/` (or a prebuilt artifact) on keys derived from the stamp fields.

---

## Test harness (Vitest)

- **`vitest.config.ts`:** main suite **excludes** `src/server/evals/**` so normal `npm test` does not require a built eval home.
- **`npm run eval:run`:** runs Vitest with **`vitest.eval.config.ts`** (`src/server/evals/**/*.test.ts`), then every JSONL LLM suite (Enron v1, Wiki v1) via [`scripts/eval-run.mjs`](../../scripts/eval-run.mjs); `BRAIN_HOME=./data-eval/brain`. See [`eval/README.md`](../../eval/README.md).

---

## What to update when you change the system

| Change | Update |
|--------|--------|
| New corpus or manifest | [`eval/fixtures/`](../../eval/fixtures/) + this doc + [`eval/README.md`](../../eval/README.md) |
| New npm scripts or paths | [`package.json`](../../package.json) + [`eval/README.md`](../../eval/README.md) |
| Ripmail only indexes `.eml` | This doc + [`rebuild_index.rs`](../../ripmail/src/rebuild_index.rs) if behavior changes |
| Stamp fields | [`scripts/eval/build-enron-kean.mjs`](../../scripts/eval/build-enron-kean.mjs) + this **Invalidation** section |
| Product eval strategy | [`wiki-and-agent-evaluation.md`](../wiki-and-agent-evaluation.md) |

---

*Next: [integrations.md](./integrations.md) (ripmail in app) · [data-and-sync.md](./data-and-sync.md) (`$BRAIN_HOME`)*
