# OPP-016: Multi-Inbox — One Install, Many Mailboxes

**Status:** Archived — mostly implemented. **Archived:** 2026-04-10. Unified DB, `mailboxes[]`, composite sync, and multi-mailbox CLI paths shipped; optional follow-ups (default send mailbox, parallel refresh) remain in this doc.

**CLI note (2026-04):** Older drafts referred to `**ripmail update`** — the shipped command is `**ripmail refresh**` (fetch/backfill). Treat `**update**` as `**refresh**` if you see it in external notes.

## Context

ripmail today is single-inbox: one IMAP identity, one config shape, one password. That is enough for one person and one address, but it breaks down when:

- Someone wants **personal and work** (or school and side project) in one agent workflow without juggling two installs or `RIPMAIL_HOME` switches.
- An **operator or assistant stack** (e.g. **OpenClaw** or similar) needs **many distinct addresses** as first-class inboxes: `info@mycompany.com`, `support@mycompany.com`, `invoices@mycompany.com`, onboarding aliases, founder + shared mailboxes, etc. — **dozens** is a design target, not an edge case.

We want a **single installation** where:

- **Default path is simple:** sync and search see **all configured mailboxes** unless the user or config narrows scope.
- **Power path is explicit:** filter by **email address** (intuitive id), optional per-mailbox rules, optional “exclude from default search” for archival or low-priority boxes.
- **One place to reason about policy:** all non-secret mailbox settings live in **one root `config.json`** — no nested `config.json` per mailbox to drift or forget.

## Design principles

- **Scale in the dozens** — Config is a list, not a forest of files. Filesystem layout stays **flat**: no `accounts/` umbrella, no extra `data/` layer under each mailbox for the shared index. Per-mailbox dirs are **only** what must be physically separate: **secrets** and **that mailbox’s maildir**.
- **Dead-simple agent default** — `**ripmail refresh`** runs over **all** mailboxes (respecting optional per-mailbox disable flags if we add them). `**ripmail search`** (and MCP equivalents) hit **one** database; default scope is **all mailboxes included in search** (see below).
- **One unified SQLite DB** — `messages` (and related rows) carry a `**mailbox_id`** (stable string, typically derived from config). `**sync_state**` is keyed by `**(mailbox_id, folder)**` so two Gmail workspaces can both use `[Gmail]/All Mail` without collision. **No** fan-out across multiple DBs for global search — FTS ranking stays coherent.
- **Identify mailboxes by email in the CLI** — Humans and agents think in `**support@company.com`**. Resolve to `**mailbox_id**` / slug internally; accept email or slug where unambiguous.
- **Config vs secrets** — **No secrets in `config.json`.** Shared secrets (e.g. OpenAI) in **root `~/.ripmail/.env`**; IMAP (and later SMTP) passwords in **per-mailbox `.env`** only.

## Proposed design

### Config: single root `config.json` (all mailboxes)

- **One file** at `RIPMAIL_HOME/config.json` lists every mailbox and global knobs. **No** per-mailbox `config.json` — everything non-secret is here so diffs, reviews, and agent edits stay tractable with **many** entries.

```json
{
  "mailboxes": [
    {
      "id": "support_company_com",
      "email": "support@mycompany.com",
      "search": { "includeInDefault": true }
    },
    {
      "id": "invoices_company_com",
      "email": "invoices@mycompany.com",
      "imap": { "host": "imap.gmail.com", "port": 993 },
      "search": { "includeInDefault": true }
    },
    {
      "id": "archive_company_com",
      "email": "legacy@mycompany.com",
      "search": { "includeInDefault": false }
    }
  ],
  "sync": { "defaultSince": "1y", "excludeLabels": ["Trash", "Spam"] },
  "attachments": { "cacheExtractedText": false }
}
```

**Note:** Global **`sync`** in the sketch above matches **today’s** on-disk shape; a follow-up is to move sync (and optional SMTP overrides) **per mailbox** — see [OPP-044](OPP-044-per-mailbox-sync-and-smtp-config.md).

- `**id**` — Stable `**mailbox_id**` for schema, paths, and compact CLI. Required when email alone is ambiguous or filesystem-safe slugs are needed.
- `**email**` — Canonical IMAP user / From identity; primary human-facing identifier.
- `**search.includeInDefault**` — When `false`, **default** search (no mailbox filter) **omits** this mailbox; explicit `mailbox:` / `--mailbox` still includes it. Keeps “search everything I care about daily” clean when some boxes are huge or archival.
- Defaults (IMAP host/port, sync, attachments) apply globally; per-mailbox blocks override only what differs.

### `mailbox_id` and directory naming

- Prefer an explicit `**id`** in config (e.g. `support_company_com`) over encoding rules alone — **dozens** of addresses make reversible email→path schemes harder to eyeball. Document a **recommended** slug recipe (`@` → `_`, `.` → `_`) for new entries.
- Code resolves `**email` ↔ `id`** from the single config load; CLI accepts **either** where unique.

### Secrets: root `.env` + per-mailbox `.env`

- `**~/.ripmail/.env`** — Shared only: e.g. `RIPMAIL_OPENAI_API_KEY` / `OPENAI_API_KEY`. **No** per-mailbox IMAP passwords here (avoids `PASSWORD_WORK` explosion).
- `**~/.ripmail/<id>/.env`** — That mailbox’s `**RIPMAIL_IMAP_PASSWORD**` (same variable name everywhere; loader picks file by `mailbox_id`).

### Filesystem layout (flat)

Unified index at the home root; per-mailbox dirs hold **secrets + maildir** only (no second config file, no per-mailbox DB).

```text
~/.ripmail/
  config.json           # all mailboxes + global settings (no secrets)
  rules.json            # global inbox rules (see below)
  ripmail.db              # single SQLite (+ WAL/SHM alongside)
  .env                  # shared API keys only
  logs/                 # optional; sync logs, etc.
  <mailbox_id>/
    .env                # IMAP password for this mailbox
    maildir/            # this mailbox’s on-disk mail (rebuild/sync provenance)
    rules.json          # optional: per-mailbox rules (override/extension)
```

- `**ripmail.db**` lives at `**RIPMAIL_HOME/ripmail.db**` (not under a redundant `data/` segment for the DB — optional `data/` subdir is an implementation detail if we keep compatibility with existing paths during migration).
- `**raw_path**` / maildir paths in SQLite are scoped under `<mailbox_id>/maildir/...` so ownership is obvious and rebuild walks the right tree.
- **Optional shared caches** (e.g. future vectors): either under `~/.ripmail/cache/` or next to the DB — keyed by content with `mailbox_id` in app logic where needed.

This stays **flat** (no `accounts/` prefix), **one config file**, and scales to **many** sibling `<mailbox_id>/` directories without extra nesting.

### Inbox rules (global + optional per-mailbox)

- `**~/.ripmail/rules.json`** — Default rule pack and patterns shared across mailboxes (OTP, generic bulk mail, etc.).
- `**~/.ripmail/<mailbox_id>/rules.json**` — Optional **additions or overrides** for that mailbox (e.g. `support@` triage vs `invoices@` triage).
- **Evaluation order** should be **documented and fixed** (e.g. global rules first, then per-mailbox appended so mailbox-specific rules can win on first match — matches today’s “ordered list, first match wins” model).
- `**rules_fingerprint`** for inbox cache invalidation should reflect the **effective** rules for that mailbox (e.g. hash global + hash per-mailbox, or hash merged list).

### Sync / refresh

- **Default:** iterate **all** enabled mailboxes in `config.json`, load `<id>/.env`, sync into unified DB + `<id>/maildir/`.
- **Narrow:** `ripmail refresh --mailbox support@mycompany.com` or `--mailbox support_company_com` for one box (debugging, rate limits, backfill).
- **Ordering:** config list order is a reasonable default; optional `**sync.priority`** (integer) later if some mailboxes should refresh first.

### Search, read, thread, MCP

- **Default search:** all mailboxes with `**search.includeInDefault !== false`** (missing = true). Single FTS query + `mailbox_id` filter in SQL when narrowing.
- **Explicit filter:** query operator `**mailbox:`** / `**inbox:**` (exact surface TBD) **or** CLI flag `**--mailbox <email|id>`** on commands that need scope.
- **JSON rows** should include `**mailboxId`** (and ideally `**email**`) so agents disambiguate when results mix many inboxes.
- **MCP tools** mirror CLI: optional mailbox parameter; default = same as CLI default search scope.

### `ripmail status`

- With **many** mailboxes, status should stay readable: **one line per mailbox** (email, id, last sync, message count delta) in text mode; `**--json`** for agents (full list, structured errors per mailbox).
- Optional **summary line** at top: N configured, M healthy, last global refresh.

### `ripmail setup` and `ripmail wizard` (product direction)

Multi-inbox shifts onboarding from **“run once to bootstrap”** to **“add or update mailboxes anytime.”** The two commands keep distinct roles:


| Command            | Role                                   | Direction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**ripmail setup`**  | Non-interactive, agent/script-friendly | **Register or update one mailbox per invocation:** required `--email` / `RIPMAIL_EMAIL`, `--password` / `RIPMAIL_IMAP_PASSWORD` for **that** mailbox; optional `--id` (stable `mailbox_id`; default = slug from email); optional `--imap-host` / `--imap-port` when not Gmail. Shared OpenAI key stays in **root** `~/.ripmail/.env`; IMAP password for the mailbox goes to `**~/.ripmail/<id>/.env`** only. Merge into `config.json` `mailboxes[]` (upsert by id) without wiping other entries. Validate IMAP/SMTP for the mailbox being configured; print resolved `id` and a hint like `ripmail refresh --mailbox <email>`. |
| `**ripmail wizard**` | Interactive, human-first               | **Menu-driven:** first install vs **add mailbox** vs **edit mailbox** vs **shared settings** (OpenAI in root `.env`, global sync defaults). Per-mailbox flow: email → IMAP (derived or prompted) → password (reuse from `<id>/.env` when present). `**--clean`** remains a full reset; consider a separate **remove mailbox** path later so “clean” is not the only hammer. End with optional **sync** for the mailbox just added or all mailboxes.                                                                                                                                                                  |


**New installs** (today’s code): `setup` / wizard write `**mailboxes`**, per-mailbox `.env`, root `.env` for API keys only, `ripmail.db` at `RIPMAIL_HOME`, and `<id>/maildir/` — see [Filesystem layout](#filesystem-layout-flat) and `[layout_migrate.rs](../../src/layout_migrate.rs)` for legacy migration.

### Legacy single-mailbox → multi-inbox filesystem migration

**Implemented** in `[src/layout_migrate.rs](../../src/layout_migrate.rs)`. On `[load_config](../../src/config.rs)`, if the home still matches the **old** layout — top-level `imap.user` in `config.json`, **no** `mailboxes` array yet, and `**data/ripmail.db`** present — ripmail **migrates once**:

1. Derives `**mailbox_id`** from the IMAP user email (`[derive_mailbox_id_from_email](../../src/config.rs)`).
2. Moves `**data/maildir/**` → `**<mailbox_id>/maildir/**`; `**data/ripmail.db**` → `**ripmail.db**` at `RIPMAIL_HOME` (including `-wal`/`-shm` when present).
3. Rewrites `**messages.raw_path**` and `**attachments.stored_path**` in SQLite to prefix `**mailbox_id/**` so paths resolve against `RIPMAIL_HOME` as the message root.
4. Splits `**.env**`: `**RIPMAIL_IMAP_PASSWORD**` → `**<mailbox_id>/.env**`; root `**.env**` keeps only shared keys (e.g. OpenAI).
5. Rewrites `**config.json**` to the `**mailboxes**` shape (drops top-level `**imap**`).

`**data/drafts/**` and other non-maildir content under `**data/**` stay in place; drafts remain under `**~/.ripmail/data/**`. A line is printed to stderr when migration runs successfully; failures are non-fatal to startup (user can fix or wipe and re-sync per project norms).

## Schema impact

- `**messages`:** add `**mailbox_id TEXT NOT NULL`** (backfill for legacy single-inbox rows).
- `**sync_state`:** composite key `**(mailbox_id, folder)`** (or encoded single key). Same idea for any folder-scoped sync tables.
- **Attachments / threads:** ensure foreign rows either carry `**mailbox_id`** or join through `messages` so cross-mailbox leaks are impossible.
- **FTS:** join to `messages` and filter on `**mailbox_id`** when the user narrows scope.
- `**message_id`:** consider composite uniqueness `**(mailbox_id, message_id)`** if the same provider Message-ID could theoretically appear twice across workspaces (defensive; Gmail-style global ids are usually fine).

## Backward compatibility

- **Runtime:** `[load_config](../../src/config.rs)` accepts **either** legacy `**imap`** + `**data/**` paths **or** `**mailboxes`** + home-level `**ripmail.db**` + `[Config::message_path_root](../../src/config.rs)` for indexed paths. **Automatic migration** from legacy disk layout is described [above](#legacy-single-mailbox--multi-inbox-filesystem-migration).
- **Conceptual:** multi-inbox still needs `**mailbox_id`** on SQLite rows and composite `**sync_state**` keys — see [Schema impact](#schema-impact); filesystem migration does not complete the full OPP-016 data model by itself.

## Implementation status (in-tree, 2026-04)


| Area                 | Notes                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema               | `messages.mailbox_id`; `sync_state` primary key `(mailbox_id, folder)`; `sync_windows.mailbox_id`; see `SCHEMA_VERSION` in `src/db/schema.rs`.                   |
| Config               | `search.includeInDefault`; `ResolvedMailbox`; `mailbox_ids_for_default_search` / `resolve_mailbox_spec` in `src/config.rs`.                                      |
| Sync / CLI           | Multi-mailbox `ripmail refresh` with `--mailbox`; `SyncResult.mailboxes` + refresh JSON `mailboxes` in `src/refresh.rs`.                                           |
| Search / inbox / who | `--mailbox` filter; JSON `mailboxId` on search hits (`src/search/`).                                                                                             |
| Setup                | `upsert_mailbox_setup` merges into `mailboxes[]` by id; `ripmail setup --id`, `--imap-host`, `--imap-port` (`src/setup.rs`).                                       |
| Wizard               | Multi-inbox `ripmail wizard`: inbox list + add + done; shared settings (OpenAI + sync) after add/edit; `spawn_sync_background_detached` uses `refresh` with optional `--mailbox` (`src/wizard/mod.rs`, `src/sync/background_spawn.rs`). |
| Status               | `mailbox_status_lines` — text “Per mailbox” section + `--json` `mailboxes` array (`src/status.rs`).                                                              |
| Rules                | `load_effective_rules_for_mailbox`, `inbox_rules_fingerprint_for_scope`; `ripmail rules --mailbox` for overlay path (`src/rules.rs`, `src/cli/commands/rules.rs`). |


## Open questions

- **DB path:** legacy migration moves the DB to `**~/.ripmail/ripmail.db`**; multi-mailbox semantics are in-schema as above.
- **CLI flag name:** standardize on `**--mailbox`** (matches OPP-016 history) vs `**--account**` — pick one, alias the other if needed.
- **Default send mailbox** ([OPP-011](OPP-011-send-email.md)): explicit `**defaultSendMailbox`** in config vs first in list vs last-used.
- **Parallel refresh:** one writer on SQLite — serialize sync jobs vs pipeline per mailbox with explicit locking story ([ARCHITECTURE.md](../ARCHITECTURE.md) WAL notes).

## Summary


| Area                 | Choice                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scale**            | Designed for **many** mailboxes (personal + work + role addresses + operators); one root config, flat dirs.                                                                                                  |
| **DB**               | **One** unified SQLite DB; `**mailbox_id`** on messages; `**sync_state**` keyed by mailbox + folder.                                                                                                         |
| **Config**           | **Single** `config.json` at `RIPMAIL_HOME`; **no** per-mailbox config files; optional `**search.includeInDefault`**.                                                                                           |
| **Secrets**          | Root `.env` (shared API keys); `**<mailbox_id>/.env`** (IMAP password per mailbox).                                                                                                                          |
| **Layout**           | `**ripmail.db`** at home root; `**<mailbox_id>/.env**` + `**<mailbox_id>/maildir/**`; optional `**<mailbox_id>/rules.json**`.                                                                                  |
| **Rules**            | Global `**rules.json`** + optional per-mailbox rules; **composite fingerprint** for inbox cache.                                                                                                             |
| **Sync**             | Default: **all** mailboxes; optional `**--mailbox`** to narrow.                                                                                                                                              |
| **Query / CLI**      | Default search = all **included** mailboxes; filter by **email or id**; JSON exposes mailbox fields.                                                                                                         |
| **Status**           | Per-mailbox lines + **JSON** for large sets.                                                                                                                                                                 |
| **Setup / wizard**   | `**setup`** = repeatable, one mailbox per run, flags/env; `**wizard**` = add/edit/shared settings; see [§ setup and wizard](#ripmail-setup-and-ripmail-wizard-product-direction).                                |
| **Legacy migration** | Automatic filesystem + SQLite path prefix + env split + `config.json` rewrite when old `data/ripmail.db` + legacy `imap` present; see [§ migration](#legacy-single-mailbox--multi-inbox-filesystem-migration). |


