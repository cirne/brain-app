# OPP-049: Gmail Archive Using Stored Label Metadata (Faster IMAP)

**Status:** Archived — **implemented** (2026-04-14). **Created:** 2026-04-14. **Tags:** imap, gmail, archive, sync, performance

**Related:** [BUG-055](../../bugs/archive/BUG-055-imap-archive-slow.md), [BUG-054](../../bugs/archive/BUG-054-gmail-imap-archive-noop.md), [OPP-033](OPP-033-imap-write-operations-and-readonly-mode.md)

---

## Shipped behavior

When **`mailboxManagement.enabled`** is true and the message row is Gmail **All Mail** with non-empty **`messages.labels`** containing an Inbox label (`\Inbox` / `Inbox`), **`ripmail archive`**:

1. **`SELECT`** the stored folder (e.g. `[Gmail]/All Mail` or `[GoogleMail]/All Mail`).
2. **`UID STORE <uid> -X-GM-LABELS (\Inbox)`** — Gmail extension; Google documents **`+X-GM-LABELS`** for adding labels ([IMAP extensions](https://developers.google.com/workspace/gmail/imap/imap-extensions)); removal uses the same attribute with **`-`** (standard `STORE` add/remove pattern).

**No `UID SEARCH`** on that path.

If **`STORE` fails** (stale metadata) or **`labels` is empty** / parse error, fall back to **`SELECT INBOX`** + **`UID SEARCH X-GM-RAW "rfc822msgid:…"`** (then **`UID MOVE`**), as before.

If **All Mail** + **non-empty labels** without Inbox → **provider noop** (treat as already not in Inbox per index).

**CLI unchanged:** `ripmail archive <MESSAGE_ID>`.

**Code:** [`src/mailbox/archive.rs`](../../../src/mailbox/archive.rs) — `gmail_provider_archive`, `gmail_try_remove_inbox_label_uid_store`, `gmail_archive_search_and_move`.

---

## Problem (historical)

`ripmail archive` with `mailboxManagement` must change Gmail’s server state (remove the Inbox label). Earlier implementations used **`UID SEARCH`** in INBOX even after **`X-GM-RAW`** optimization; large INBOX searches could still be slow.

Ripmail already **fetches Gmail label metadata** during sync: **`X-GM-LABELS`** on **`UID FETCH`** (`src/sync/transport.rs`), stored as JSON in **`messages.labels`**.

---

## Risks (still relevant)

- **Stale `labels`:** User changes mail elsewhere; **`STORE`** may fail → **fallback search** handles it.
- **Gmail behavior changes:** Re-verify **`X-GM-LABELS`** `STORE` if reports of regressions.

---

## Acceptance criteria (met)

- **`ripmail archive <id>`** unchanged for users.
- Gmail archive **skips `UID SEARCH`** when fast path **`STORE`** succeeds.
- **`cargo test`** green.
