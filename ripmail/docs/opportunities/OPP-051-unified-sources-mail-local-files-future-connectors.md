# OPP-051: Unified Sources — Mail, Local Files, and Future Connectors

**Status:** Active — design / future work.

**Created:** 2026-04-16.

---

## Design constraint (read this first)

**We do not owe continuity to historical SQLite schema, `config.json` shape, on-disk layout, or CLI flags for this effort.**

Design **from a clean slate**: assume developers and early users can **delete `RIPMAIL_HOME`**, wipe the index, and reconfigure. **Do not** spend complexity budget on migrating old `mailboxes[]` rows, preserving legacy column names, or dual-read paths unless a maintainer explicitly demands a transition window.

This opp describes the **target architecture**, not an incremental refactor plan.

---

## Summary

Today ripmail's mental model is **mailboxes** (IMAP, Apple Mail localhost, etc.): one `mailboxes[]` array, `--mailbox` on search/read/refresh, and a message-centric SQLite schema.

The product opportunity is a **unified personal corpus**: email remains primary, but **local directories** (e.g. `~/Documents`, `~/Desktop`) and **future connectors** (Notion, Apple Notes, …) should be **first-class sources** in one index and one CLI, not a separate batch job in a host app.

**Direction:** Replace the mailbox-only config with a `sources` list: each entry has a stable `id`, a `kind` (`imap`, `appleMail`, `localDir`, …), shared knobs (e.g. **include in default search**), and kind-specific fields. `refresh` updates every indexable source; `search` / `read` (and JSON output) identify which source a hit came from. Mail-specific commands (`draft`, `send`, `inbox`, `archive`, …) apply only to **mail** sources and error clearly if scoped to a non-mail source.

---

## Problem

- **Email-only config** does not generalize: folders and connectors are forced into ad hoc solutions or duplicate indexing outside ripmail.
- `--mailbox` implies IMAP semantics; local folders are not "mailboxes."
- **Agents and UIs** want one `search` story over "everything I care about," with filters by source when needed.

---

## Opportunity

1. **Local directories as sources** — Walk configured paths, extract text (reuse attachment pipelines: PDF, DOCX, HTML, etc.), index in SQLite + FTS (exact table shape is a clean-slate decision).
2. **One orchestrated sync** — `ripmail refresh` runs mail sync + directory crawl + (later) connector sync; per-source scoping via `--source <id>`.
3. **Extensible kinds** — New connector = new `kind` + resolved variant + secrets under `RIPMAIL_HOME/<id>/`; same top-level UX (`search`, `status`).
4. **Brain-app alignment** — Host app can call one CLI; no parallel "wiki batch indexer" required for local files if ripmail owns the index (see brain-app product direction separately).

---

## Proposed configuration (clean slate)

Illustrative only — names and fields may change; **no requirement** to match current `mailboxes[]`.

```json
{
  "sources": [
    {
      "id": "personal-gmail",
      "kind": "imap",
      "email": "user@gmail.com",
      "search": { "includeInDefault": true },
      "imap": { "host": "imap.gmail.com", "port": 993 }
    },
    {
      "id": "dev-notes",
      "kind": "localDir",
      "path": "~/dev",
      "label": "Dev markdown",
      "search": { "includeInDefault": true },
      "localDir": {
        "include": ["*.md", "*.txt"],
        "ignore": ["**/node_modules/**", "**/target/**", "**/.next/**"],
        "respectGitignore": true,
        "maxDepth": 12,
        "maxFileBytes": 1000000
      }
    },
    {
      "id": "documents",
      "kind": "localDir",
      "path": "~/Documents",
      "label": "Documents",
      "search": { "includeInDefault": true },
      "localDir": {
        "include": ["*.md", "*.txt", "*.pdf", "*.docx"],
        "respectGitignore": false,
        "maxDepth": 8,
        "maxFileBytes": 20000000
      }
    }
  ]
}
```

**Shared fields (conceptual):** `id` (globally unique), `kind`, optional `label`, `search.includeInDefault` (or equivalent).

**Kind-specific:** IMAP/OAuth/Apple Mail blocks today; `localDir` adds path + glob filters + depth/size limits; future kinds add their own blocks.

### `localDir` field notes

`**include`** — gitignore-style glob allowlist. If omitted, all files are candidates (subject to `ignore` and size limits). Typical patterns: `["*.md", "*.txt"]` for notes-only, `["*.pdf", "*.docx"]` for documents. Globs are matched against the relative path from `path`.

`**ignore`** — gitignore-style denylist applied after `include`. Stacks with `.gitignore` when `respectGitignore` is true.

`**respectGitignore**` — when `true` (default for `localDir`), ripmail obeys `.gitignore`, `.ignore`, and the global git ignore file, exactly as ripgrep does (via the Rust `ignore` crate). This is the right default for `~/dev` trees: build output, `node_modules`, `target/`, etc. are automatically skipped without listing every pattern manually. Set to `false` for non-git directories like `~/Documents`.

**Size limit:** `maxFileBytes` applies before conversion. Files over the limit are skipped and logged (not silently dropped).

---

## CLI (clean slate)

### Query and sync flags


| Change                          | Intent                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--source <id>` (or short `-S`) | Generic scope for indexable content: search, read, refresh, status. Replaces or aliases `--mailbox` for unified semantics.        |
| `refresh`                       | All sources by default; `--source` limits. Mail-only flags (`--since`, …) apply when the selected source is mail.                 |
| **Mail-only commands**          | `draft`, `send`, `inbox`, `archive`, etc. require a **mail** source; error if `localDir` / future read-only sources are selected. |


JSON contracts for `search` / `read` should include `sourceId` and `sourceKind` (exact names TBD) so agents do not infer from shape alone.

### `ripmail read` — single entry point

**Chosen design (clean slate):** one command, same multi-target story as today:

```text
ripmail read <TARGET>… [--raw] [--json] [--text] [--source <id>]
```

Each `TARGET` is resolved with **best-effort disambiguation** (no separate `ripmail email read` / `ripmail file read`):

- **Filesystem paths** — try absolute paths, tilde expansion (`~/…`), paths relative to the current working directory, in a documented order so behavior is predictable.
- **Email Message-IDs** — bare id, with angle brackets, and other common shapes the indexer stores (normalize before lookup).

Implementation picks the first interpretation that succeeds (e.g. if a path exists on disk, read that file; otherwise look up as message id in the mail index). **Rare collisions** (same string could be a relative path and a message id): document a tie-breaker or require `--source` to narrow the namespace.

**Rejected alternative:** `ripmail email read …` and `ripmail file read …` — clearer typing, but two mental models, duplicated flags, and a worse agent surface (two commands to learn, harder to chain from unified `search`).

**Optional later:** a stable `docId` from `search` JSON that `read` accepts verbatim (implementation resolves via DB). Not required if `search` always returns a `TARGET` string that already fits the rules above (e.g. path for `localDir` hits, Message-ID for mail).

### Source management subcommands

These let agents and users manage sources without editing `config.json` by hand. An agent can translate a natural-language request ("add my dev projects, markdown only") into a single CLI call.

```
ripmail sources list [--json]
    List all sources: id, kind, path/email, label, includeInDefault, last-synced.

ripmail sources add --kind localDir --path <path> [--id <id>] [--label <label>]
                    [--include <glob>]... [--ignore <glob>]...
                    [--no-gitignore] [--max-depth <n>] [--max-file-bytes <n>]
                    [--no-default-search]
    Add a new localDir source. --id defaults to a slug derived from --label or path.
    Prints the new source id on stdout (JSON: { "id": "..." }).

ripmail sources add --kind imap --email <addr> [--id <id>] [--label <label>]
                    [--password <pw>] [--google-oauth] [--no-default-search]
    Add an IMAP mail source (same credential flow as current `ripmail setup`).

ripmail sources edit <id> [--label <label>] [--include <glob>]... [--ignore <glob>]...
                          [--no-gitignore] [--default-search on|off] [--path <path>]
    Update fields on an existing source. Only provided flags are changed.

ripmail sources remove <id> [--yes]
    Remove source from config and purge its rows from the index.
    Requires --yes or interactive confirmation (like `ripmail clean`).

ripmail sources status [<id>] [--json]
    Sync health, last crawl time, document/message count per source.
```

**Agent workflow example** — user says "add ~/dev/my-project, markdown files only":

```bash
ripmail sources add --kind localDir --path ~/dev/my-project \
  --label "my-project notes" --include "*.md"
ripmail refresh --source my-project-notes
```

All `sources` subcommands support `--json`. `sources add` outputs `{ "id": "..." }` on success so agents can immediately chain to `refresh --source <id>`.

---

## Storage and indexing (non-prescriptive)

- **Clean-slate schema:** separate tables for mail vs files vs future connectors, or a unified `documents` abstraction — **decide in implementation** without preserving current `messages`-only FTS layout if something simpler fits.
- **Rebuild:** schema bump or `rebuild-index`-style command may **wipe and reindex** from sources; acceptable per repo norms.

### File content: no copy, no symlink

For `localDir` sources, ripmail should **not copy or symlink files**. Instead:

- **Index-time:** walk the source tree (obeying `include`/`ignore`/`.gitignore`), extract text as needed, store FTS content + the **original absolute path** + `mtime`/size in SQLite. Change detection on re-crawl: if `mtime` and size match, skip re-extraction.
- **Read-time:** when `ripmail read` resolves `TARGET` to a file path, read **live from disk** (same disambiguation rules as the `ripmail read` subsection above). Plain-text (`.md`, `.txt`, code) is zero-cost. Conversion-heavy formats (PDF, DOCX) use cache under `RIPMAIL_HOME/<source-id>/cache/` keyed by path hash + mtime.
- **Why not copy?** Copies go stale silently. Re-crawl would need to diff and re-copy — net complexity with no benefit over reading originals.
- **Why not symlinks?** Fragile across volumes, broken by moves, and require elevated privileges on Windows. The original absolute path is the canonical reference.

**Cache policy:** conversion cache (PDF, DOCX, HTML) lives under `RIPMAIL_HOME`. Plain `.md`/`.txt`/code is always read live. Cache invalidated by `mtime` + size change.

---

## Future connectors

Examples: **Notion**, **Apple Notes**, read-only cloud APIs. Each gets a `kind`, optional OAuth/setup subcommands, and rows keyed by `source_id` + remote stable id. **OPP-045** (iMessage / chat) shares the "channel + identity" lesson: do not force chat into email-shaped rows; do align on **one DB + explicit source/channel metadata**.

---

## Related

- [OPP-016 archived](archive/OPP-016-multi-inbox.md) — historical multi-inbox; this opp supersedes the *config model* for new work.
- [OPP-045](OPP-045-imessage-and-unified-messaging-index.md) — paused messaging index; unified **source** concept should fit the same direction.
- [OPP-050](OPP-050-applemail-localhost-mailbox.md) — Apple Mail as a mailbox **kind**; in a `sources` world it becomes one `kind` among others.

---

## Open questions

1. **ID namespace:** single global `id` string vs prefixed ids (`mail:…`, `dir:…`) — prefer simple global ids for CLI.
2. **Default search:** union of all `includeInDefault` sources vs opt-in per session.
3. **Symlink policy for `localDir` crawl:** follow symlinks to dirs? Follow symlinks to files? Cycle detection needed either way — document the chosen policy at implementation time.
4. `**include` glob scope:** match against filename only vs full relative path — full relative path is more powerful (e.g. `docs/**/*.md`) but may surprise users who write `*.md`.
5. **Naming:** product may eventually rename the binary or user-facing strings if "ripmail" is too mail-specific — out of scope for this opp's technical content.

