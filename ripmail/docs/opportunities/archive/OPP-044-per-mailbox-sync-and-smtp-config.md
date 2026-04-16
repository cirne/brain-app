# OPP-044: Per-Mailbox Sync and SMTP in `config.json`

**Status:** Archived — mostly implemented. **Archived:** 2026-04-10. Multi-inbox and shared sync/SMTP work; **per-mailbox** `sync` / `smtp` blocks described here are not fully modeled yet — recover this doc when scheduling that work.

## Context

Multi-inbox is shipped ([OPP-016 archived](OPP-016-multi-inbox.md)), but **sync** and optional **SMTP** overrides are still modeled as **global** keys on `config.json`:

- **`sync`** — `defaultSince`, `mailbox` (IMAP folder to sync), and `excludeLabels` apply to **every** mailbox. The sync loops in `src/cli/triage.rs` reuse one `sync_mailbox` string and one exclude list for all accounts; `resolve_sync_since_ymd` runs once per run, so implicit backfill uses a single window for all mailboxes.
- **`smtp`** — Optional root-level `SmtpJson` overrides inferred SMTP for **all** send-as flows that reload config (`config_for_outbound_send` uses `json.smtp`).

That is wrong for common setups: e.g. work vs personal may need different backfill windows, different label excludes, different “All Mail” vs `INBOX` folder choice, or different SMTP endpoints when providers differ.

## What `smtp: null` means today

`null` or a missing **`smtp`** key is **not** broken or useless. **`resolve_smtp_settings(imap_host, None)`** infers host/port/TLS from the **IMAP host** (e.g. Gmail → `smtp.gmail.com:587`). **Credentials** for app-password mailboxes come from the same mailbox’s IMAP password, not from JSON. So send works without any `smtp` block; `null` literally means “no override, use inference + mailbox credentials.”

## Proposed direction

1. **Move `sync` under each `mailboxes[]` entry** — Each mailbox gets its own `defaultSince`, `mailbox` (folder), and `excludeLabels`, with the same reasonable defaults as today when omitted on **new** accounts (`1y`, empty string → provider-specific folder via `resolve_sync_folder_for_host`, `Trash`/`Spam` excludes).
2. **Move optional `smtp` under each mailbox** — Same semantics as today: omitted/`null` → infer from that mailbox’s IMAP host; non-null → three-field override (`host`, `port`, `secure`).
3. **Remove top-level `sync` and `smtp`** from the canonical on-disk shape after migration (no global defaults; wizard “shared sync window” can still **bulk-update** every mailbox’s `sync.defaultSince` in one action if we want that UX).
4. **Runtime** — Extend `ResolvedMailbox` (or equivalent) with resolved sync fields + `ResolvedSmtp` per mailbox; inside the per-mailbox sync loop, use each mailbox’s folder, excludes, and **per-mailbox** `resolve_sync_since_ymd` when the CLI does not pass an explicit `--since`.

## Example target shape (illustrative)

```json
{
  "mailboxes": [
    {
      "id": "alice_gmail_com",
      "email": "alice@gmail.com",
      "imap": { "host": "imap.gmail.com", "port": 993 },
      "sync": {
        "defaultSince": "1y",
        "mailbox": "",
        "excludeLabels": ["Trash", "Spam"]
      }
    },
    {
      "id": "bob_work_com",
      "email": "bob@work.example",
      "imap": { "host": "imap.work.example", "port": 993 },
      "sync": {
        "defaultSince": "90d",
        "mailbox": "",
        "excludeLabels": ["Trash", "Spam"]
      },
      "smtp": {
        "host": "smtp.work.example",
        "port": 587,
        "secure": false
      }
    }
  ]
}
```

## Migration (when implemented)

- **Normalize on load** (or one-shot migrate): if root `sync` / `smtp` exist, copy into each `mailboxes[]` entry that lacks its own, then strip root keys and rewrite `config.json`.
- **`layout_migrate`:** When building the first `mailboxes[]` entry from legacy top-level `imap`, embed `old.sync` / `old.smtp` on that mailbox so nothing is lost.
- **Serde:** Consider `skip_serializing_if` so optional `smtp` is omitted instead of `"smtp": null` when unused.

## Scope / touchpoints (for implementers)

- `src/config.rs` — `ConfigJson`, `ResolvedMailbox`, `build_resolved_mailboxes`, `load_config`, `config_for_outbound_send`.
- `src/setup.rs`, `src/wizard/mod.rs` — `upsert_mailbox_*`, shared settings, `load_existing_wizard_config`.
- `src/cli/triage.rs`, `src/sync/run.rs`, `src/cli/commands/sync.rs`, `src/status.rs` — per-mailbox sync folder, excludes, and since resolution.
- `src/layout_migrate.rs` — migrated mailbox object includes nested sync/smtp.
- Tests: migration idempotence, multi-mailbox defaults, send/SMTP per mailbox; update `Config` test fixtures.

## Related

- [OPP-016 archived](OPP-016-multi-inbox.md) — multi-inbox architecture (global sync in the example there would be superseded by this opp when implemented).
- [OPP-041 archived](OPP-041-multi-mailbox-first-sync-onboarding.md) — first backfill / `defaultSince` UX; aligns with per-mailbox `sync.defaultSince`.
