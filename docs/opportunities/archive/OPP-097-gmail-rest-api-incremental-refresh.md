# OPP-097: Gmail REST API for ripmail incremental refresh (IMAP for backfill)

**Status:** Archived (2026-05-07) — **Shipped** in ripmail: Gmail OAuth **`ripmail refresh`** forward lane uses **`history.list`** + **`messages.get`** when **`sync_state.gmail_history_id`** is set; **bootstrap** from **`users.getProfile`** after a successful IMAP refresh when history id was missing; **HTTP 404** on history clears checkpoint and **falls back to IMAP**. **Implementation:** [`ripmail/src/sync/gmail_api_refresh.rs`](../../../ripmail/src/sync/gmail_api_refresh.rs), [`ripmail/src/sync/run.rs`](../../../ripmail/src/sync/run.rs), [`ripmail/src/cli/triage.rs`](../../../ripmail/src/cli/triage.rs).

**Residual / follow-ons:** Gmail API **batch** requests and tighter **`fields`** selection; **`messagesDeleted`** / label-only delta handling.

**Tags:** `ripmail` · `sync` · `gmail` · `oauth`

**Related:** [OPP-043](../OPP-043-google-oauth-app-verification-milestones.md); [OPP-098](./OPP-098-google-calendar-incremental-sync.md) (calendar refresh latency); [Gmail sync guide](https://developers.google.com/gmail/api/guides/sync).

---

## Original problem (historical)

Routine `ripmail refresh` for Gmail used IMAP against **`[Gmail]/All Mail`**: connect, **STATUS**, **EXAMINE**, **UID SEARCH** (`last_uid+1:*`), then **UID FETCH**. Even when only **one** new message existed, server round-trips and mailbox open cost routinely landed in the **many seconds**.

Braintunnel’s use case is a **read-only local copy** of mail for search, inbox, and agent tools — aligned with Gmail API **partial sync** via [`history.list`](https://developers.google.com/gmail/api/reference/rest/v1/users.history/list) with `startHistoryId`.

---

## Direction (implemented summary)

1. **Gmail-only fast path for `ripmail refresh` (forward / incremental)** — **`history.list`** (`MESSAGE_ADDED`), **`messages.get`** RAW + MINIMAL for labels; **`gmail_history_id`** on **`sync_state`**; **404** → clear id, IMAP fallback.
2. **IMAP for backfill / non-Gmail** — unchanged.
3. **Observability** — **`sync.log`** lines: `gmail_api_partial`, `gmail_api_bootstrap`, `Gmail API incremental refresh …`, existing **`Sync complete`** JSON.

---

## Suggested acceptance criteria (post-ship)

- [x] After initial checkpoint, routine refresh uses **`history.list`** when history is valid; logs show API path.
- [x] **404 / expired history** triggers fallback to IMAP and allows **bootstrap** / restore of **`historyId`** on next cycle.
- [x] **`ripmail backfill`** / backward sync remains **IMAP** (API context not passed on backfill lane).
- [x] Unit tests for label mapping + history JSON parsing; integration coverage can expand (mock HTTP).

---

## References

- [Synchronize clients with Gmail](https://developers.google.com/gmail/api/guides/sync)
- [Gmail API performance tips](https://developers.google.com/workspace/gmail/api/guides/performance)
- [Usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)
- Ripmail: [`ripmail/docs/SYNC.md`](../../../ripmail/docs/SYNC.md), [`ripmail/docs/ARCHITECTURE.md`](../../../ripmail/docs/ARCHITECTURE.md)
