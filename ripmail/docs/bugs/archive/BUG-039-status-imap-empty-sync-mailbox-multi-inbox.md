# BUG-039 — `ripmail status --imap` fails when `sync.mailbox` is empty (multi-inbox / Gmail)

**Status:** Fixed (2026-04-05). **Reported:** 2026-04-05 (agent UAT, multi-mailbox config)

## Summary

With **`sync.mailbox` set to empty** (common default; actual sync uses resolved folder names such as `[Gmail]/All Mail`), **`ripmail status --imap`** errors out instead of showing server comparison. Text mode prints the normal status lines first, then **`Error: "IMAP: No Response: [NONEXISTENT] Invalid folder:  (Failure)"`** and exits **1**. JSON mode **`ripmail status --json --imap`** fails entirely with the same error (no JSON).

## Reproduction

1. Multi-mailbox `config.json` with **`"sync": { "mailbox": "", ... }`** (or equivalent empty sync folder).
2. Run **`ripmail status --imap`** or **`ripmail status --json --imap`**.

## Expected

- IMAP probe uses the **same** resolved folder as sync (e.g. **`resolve_sync_mailbox`** semantics: Gmail → `[Gmail]/All Mail` when `sync.mailbox` is empty).
- Optionally, for multi-account setups, document or implement **per-mailbox** IMAP comparison (today’s comparison is effectively single-account legacy).

## Root cause (resolved)

- **`get_imap_server_status`** called **`mailbox_status(&cfg.sync_mailbox)`** and queried **`sync_state`** with the raw **`cfg.sync_mailbox`** string. When empty, the IMAP server rejected the folder name. Sync already used **`resolve_sync_mailbox`**.

## Resolution (2026-04-05)

- **`get_imap_server_status`** (`src/status.rs`) now uses **`resolve_sync_mailbox(cfg)`** for both **`mailbox_status`** and the **`sync_state`** folder key, matching **`mailbox_status_lines`** and the sync engine.
- Unit tests in **`src/sync/run.rs`** document **`resolve_sync_mailbox`** behavior for empty vs explicit **`sync.mailbox`** (Gmail).

## Related

- Multi-inbox direction: [OPP-016](../../opportunities/archive/OPP-016-multi-inbox.md)
