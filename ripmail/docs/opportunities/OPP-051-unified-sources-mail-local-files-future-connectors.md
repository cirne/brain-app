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

Today ripmail’s mental model is **mailboxes** (IMAP, Apple Mail localhost, etc.): one `mailboxes[]` array, `--mailbox` on search/read/refresh, and a message-centric SQLite schema.

The product opportunity is a **unified personal corpus**: email remains primary, but **local directories** (e.g. `~/Documents`, `~/Desktop`) and **future connectors** (Notion, Apple Notes, …) should be **first-class sources** in one index and one CLI, not a separate batch job in a host app.

**Direction:** Replace the mailbox-only config with a `**sources`** list: each entry has a stable `**id`**, a `**kind**` (`imap`, `appleMail`, `localDir`, …), shared knobs (e.g. **include in default search**), and kind-specific fields. `**refresh`** updates every indexable source; `**search`** / `**read**` (and JSON output) identify which source a hit came from. Mail-specific commands (`draft`, `send`, `inbox`, `archive`, …) apply only to **mail** sources and error clearly if scoped to a non-mail source.

---

## Problem

- **Email-only config** does not generalize: folders and connectors are forced into ad hoc solutions or duplicate indexing outside ripmail.
- `**--mailbox`** implies IMAP semantics; local folders are not “mailboxes.”
- **Agents and UIs** want one `**search`** story over “everything I care about,” with filters by source when needed.

---

## Opportunity

1. **Local directories as sources** — Walk configured paths, extract text (reuse attachment pipelines: PDF, DOCX, HTML, etc.), index in SQLite + FTS (exact table shape is a clean-slate decision).
2. **One orchestrated sync** — `ripmail refresh` runs mail sync + directory crawl + (later) connector sync; per-source scoping via `--source <id>`.
3. **Extensible kinds** — New connector = new `kind` + resolved variant + secrets under `RIPMAIL_HOME/<id>/`; same top-level UX (`search`, `status`).
4. **Brain-app alignment** — Host app can call one CLI; no parallel “wiki batch indexer” required for local files if ripmail owns the index (see brain-app product direction separately).

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
      "id": "docs",
      "kind": "localDir",
      "path": "~/Documents",
      "label": "Documents",
      "search": { "includeInDefault": true },
      "localDir": {
        "maxDepth": 12,
        "maxFileBytes": 20000000,
        "ignore": ["**/.git/**", "**/node_modules/**"]
      }
    }
  ]
}
```

**Shared fields (conceptual):** `id` (globally unique), `kind`, optional `label`, `search.includeInDefault` (or equivalent).

**Kind-specific:** IMAP/OAuth/Apple Mail blocks today; `localDir` adds path + ignore/size limits; future kinds add their own blocks.

---

## CLI (clean slate)


| Change                                | Intent                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `**--source <id>`** (or short `-S`)   | Generic scope for indexable content: search, read, refresh, status. Replaces or aliases `**--mailbox`** for unified semantics.    |
| `**ripmail sources list**` (optional) | Human/agent discovery: id, kind, path/email, sync health.                                                                         |
| `**refresh**`                         | All sources by default; `**--source**` limits. Mail-only flags (`--since`, …) apply when the selected source is mail.             |
| **Mail-only commands**                | `draft`, `send`, `inbox`, `archive`, etc. require a **mail** source; error if `localDir` / future read-only sources are selected. |


JSON contracts for `**search`** / `**read`** should include `**sourceId**` and `**sourceKind**` (exact names TBD) so agents do not infer from shape alone.

---

## Storage and indexing (non-prescriptive)

- **Clean-slate schema:** separate tables for mail vs files vs future connectors, or a unified `documents` abstraction — **decide in implementation** without preserving current `messages`-only FTS layout if something simpler fits.
- **Caches:** extracted text for local files may live beside the DB or in per-source dirs under `RIPMAIL_HOME`; **no obligation** to match attachment cache columns from today’s mail-only schema.
- **Rebuild:** schema bump or `rebuild-index`-style command may **wipe and reindex** from sources; acceptable per repo norms.

---

## Future connectors

Examples: **Notion**, **Apple Notes**, read-only cloud APIs. Each gets a `**kind`**, optional OAuth/setup subcommands, and rows keyed by `**source_id`** + remote stable id. **OPP-045** (iMessage / chat) shares the “channel + identity” lesson: do not force chat into email-shaped rows; do align on **one DB + explicit source/channel metadata**.

---

## Related

- [OPP-016 archived](archive/OPP-016-multi-inbox.md) — historical multi-inbox; this opp supersedes the *config model* for new work.
- [OPP-045](OPP-045-imessage-and-unified-messaging-index.md) — paused messaging index; unified **source** concept should fit the same direction.
- [OPP-050](OPP-050-applemail-localhost-mailbox.md) — Apple Mail as a mailbox **kind**; in a `sources` world it becomes one `kind` among others.

---

## Open questions

1. **ID namespace:** single global `id` string vs prefixed ids (`mail:…`, `dir:…`) — prefer simple global ids for CLI.
2. **Default search:** union of all `includeInDefault` sources vs opt-in per session.
3. **Security:** local-dir crawl must respect user intent; document symlink / path traversal policy.
4. **Naming:** product may eventually rename the binary or user-facing strings if “ripmail” is too mail-specific — out of scope for this opp’s technical content.

