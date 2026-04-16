# Gmail IMAP archive — retrospective (Rust CLI)

Single place for **what we tried**, **what we learned**, and **what to keep** vs defer. Implementation lives in `src/mailbox/archive.rs`; config is `mailboxManagement.enabled` in `config.json` (see [AGENTS.md](../AGENTS.md)).

---

## Behavior (current design)

1. **Local archive** — always: SQLite `is_archived` + maildir; fast.
2. **Provider archive** (when mailbox management is on) — Gmail-specific:
   - **Fast path:** Message is indexed under `[Gmail]/All Mail` with `messages.labels` (from sync `X-GM-LABELS`) indicating `\Inbox` → `SELECT` that folder, `UID STORE <uid> -X-GM-LABELS (\Inbox)`. No `UID SEARCH` on that path.
   - **Fallback:** `SELECT INBOX`, `UID SEARCH` via `X-GM-RAW "rfc822msgid:…"` (then quoted `HEADER Message-ID` if needed), `UID MOVE` to `[Gmail]/All Mail`.

---

## What to **keep** (clear user benefit)

| Item | Why keep |
|------|-----------|
| **Fast path (`UID STORE` on All Mail)** | Avoids expensive INBOX `UID SEARCH` on large mailboxes when labels + UID are trustworthy. |
| **Strip all leading `\` in `gmail_label_is_inbox`** | Mis-encoded `\\Inbox` in stored JSON could make “Inbox” invisible to the detector; loop fixes false negatives. |
| **Removed “noop” when labels said no Inbox** | A wrong/stale index could skip the server update; we always fall through to INBOX search + MOVE instead of returning early without IMAP. |
| **Per-step stderr timing (`SELECT` vs `UID STORE`)** | Explains wall time; usually **SELECT `[Gmail]/All Mail`** dominates (see below). |
| **`update_mailbox_management` preserves `allow`** | Merge-only updates don’t wipe `mailboxManagement.allow`. |
| **Unified `ripmail setup --mailbox-management on\|off`** | One flag; merge-only when no credential flow; avoids duplicate flags. |
| **`ripmail status` lock-aware hints** | Stale lock vs “hang” vs first-sync copy; uses live PID + lock age. |

These are small, localized changes with direct debugging or correctness benefit.

---

## What we **learned** (not bugs in ripmail per se)

1. **`SELECT [Gmail]/All Mail` can take 10–30+ seconds** on large Gmail accounts. The **`UID STORE`** afterward is often fast. Wall time users see is dominated by Gmail’s response to `SELECT`, not Rust CPU.
2. **Gmail “archive” = remove `\Inbox`**, not “move to All Mail” when the message is already in All Mail. The old generic `UID MOVE` from All Mail → All Mail was a no-op for server state ([BUG-054](bugs/BUG-054-gmail-imap-archive-noop.md) described that era).
3. **Indexed `X-GM-LABELS` in SQLite** can disagree with the web UI if mail changed on the server after sync; fallback path exists for that.
4. **Rebuild-index** seeds `labels` as `[]` and sync does not backfill labels for duplicate `message_id` rows — operators should not assume labels are complete after rebuild-only workflows (separate from archive, but affects fast path).

---

## What we **defer** (complexity vs benefit)

| Idea | Why defer |
|------|-----------|
| **IMAP connection reuse / daemon** | Large product change; batch `ripmail archive id1 id2 …` already shares one connection in one process. |
| **Avoiding `SELECT` All Mail** | IMAP requires a selected mailbox for `UID STORE` on that UID; alternatives imply different APIs (Gmail REST) or different semantics. |
| **Aggressive timeouts** | Risk of failed archives on slow networks; no strong demand yet. |

**Decision:** Accept slow provider archive for large Gmail mailboxes until a stronger requirement appears; stderr timing makes the cost visible.

---

## Related docs

- [BUG-054](bugs/BUG-054-gmail-imap-archive-noop.md) — historical no-op analysis (superseded by current Gmail paths).
- [BUG-055](bugs/BUG-055-imap-archive-slow.md) — latency notes (connection, search, fast path).
- [OPP-049 archived](opportunities/archive/OPP-049-gmail-archive-stored-labels-metadata.md) — stored-labels fast path rationale.

---

## Changelog (high level)

- **2026-04-14:** Label parsing fix (multi `\`), noop removal, SELECT/STORE timing logs; `ripmail setup` mailbox-management merge; status hang/stale hints; this document.
