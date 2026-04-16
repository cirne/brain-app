# BUG-054: Gmail IMAP Archive Is a No-Op (Message Stays in Inbox)

**Status:** Fixed (2026-04-14). **Created:** 2026-04-14. **Tags:** imap, archive, gmail, mailboxManagement

---

## Symptom (historical)

`ripmail archive` with `mailboxManagement.enabled: true` could report success while the message stayed in Gmail’s inbox.

## Root Cause (historical)

Early Gmail path used **`UID MOVE` from `[Gmail]/All Mail` to `[Gmail]/All Mail`**, which does not remove the `\Inbox` label.

## Fix (shipped)

`src/mailbox/archive.rs` now uses Gmail-specific logic:

- **Fast path:** `UID STORE … -X-GM-LABELS (\Inbox)` on All Mail when indexed labels include Inbox ([OPP-049 archived](../opportunities/archive/OPP-049-gmail-archive-stored-labels-metadata.md)).
- **Fallback:** INBOX `UID SEARCH` (prefer `X-GM-RAW` / `rfc822msgid`) + `UID MOVE` to All Mail.

See **[Gmail archive retrospective](../GMAIL_ARCHIVE_NOTES.md)** for tradeoffs and what we keep vs defer.

## Related

- [BUG-055](BUG-055-imap-archive-slow.md) — latency (connection, `SELECT` All Mail, search).
- [OPP-033 archived](../opportunities/archive/OPP-033-imap-write-operations-and-readonly-mode.md)
