# BUG-055: `ripmail archive` With IMAP Slow (Connect vs Search vs Logout)

**Status:** Partially addressed (2026-04-14); **accepted limitation** on Gmail `SELECT [Gmail]/All Mail` latency. **Created:** 2026-04-14. **Tags:** imap, archive, performance, mailboxManagement

---

## Symptom

`ripmail archive <message-id>` with `mailboxManagement.enabled: true` can take **tens of seconds** after "Connected" before JSON returns. Local-only archive (without `mailboxManagement`) is instant.

## Root Causes (measured separately)

1. **First connection** — DNS + TLS + OAuth + `AUTHENTICATE` can be ~0.3–15s depending on cache and token refresh.
2. **Gmail `UID SEARCH HEADER Message-ID` (unquoted / slow path)** — can scan a large INBOX and take **40s+**. Mitigated by preferring **`UID SEARCH X-GM-RAW "rfc822msgid:…"`** and quoted **`HEADER Message-ID "…"`** fallback (`src/mailbox/archive.rs`).
3. **IMAP `LOGOUT`** — some servers are slow; ripmail **drops the TCP session** after completion for one-shot CLI (no blocking `LOGOUT`).
4. **`SELECT [Gmail]/All Mail` (fast path)** — even when **`UID STORE`** is quick, Gmail often spends **10–30+ seconds** on `SELECT` for large mailboxes. Stderr now logs **`SELECT … took Nms`** and **`UID STORE … took Nms`** separately. This is **mostly server-side**; not fixed client-side without a different API or avoiding All Mail `SELECT`.

## Remaining Options (deferred)

1. **Connection pool / daemon** — reuse IMAP across CLI invocations; large product change.
2. **Batch archive** — `ripmail archive id1 id2 …` reuses one connection for multiple IDs in one process.

See **[Gmail archive retrospective](../GMAIL_ARCHIVE_NOTES.md)** for what we keep vs defer.

## Near-Term Fixes Shipped

- Timestamps on stderr (`Connecting` / `Connected` / `IMAP archive finished`).
- Gmail fast search + quoted HEADER fallback; skip blocking `LOGOUT`.
- **OPP-049:** stored labels + **`UID STORE -X-GM-LABELS (\Inbox)`** on All Mail when applicable; per-step `SELECT` vs `STORE` timing.

## Related

- `src/mailbox/archive.rs` — `provider_archive_message`, `connect_imap_for_resolved_mailbox`
- [BUG-054](archive/BUG-054-gmail-imap-archive-noop.md) — Gmail archive correctness (fixed)
- [OPP-049 archived](../opportunities/archive/OPP-049-gmail-archive-stored-labels-metadata.md) — stored-labels fast path
