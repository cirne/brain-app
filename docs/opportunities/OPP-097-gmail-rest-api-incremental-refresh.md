# OPP-097: Gmail REST API for ripmail incremental refresh (IMAP for backfill)

**Status:** Proposed  
**Area:** ripmail sync — Gmail / Google OAuth mailboxes  
**Updated:** 2026-05-07

---

## Problem

Routine `ripmail refresh` for Gmail uses IMAP against **`[Gmail]/All Mail`**: connect, **STATUS**, **EXAMINE**, **UID SEARCH** (`last_uid+1:*`), then **UID FETCH**. Even when only **one** new message exists, server round-trips and mailbox open cost routinely land in the **many seconds** (see `RIPMAIL_HOME/logs/sync.log` timing gaps between “Opening mailbox…”, UID search, and batch fetch).

Braintunnel’s use case is a **read-only local copy** of mail for search, inbox, and agent tools — not an interactive IMAP client. That aligns with what the **Gmail API** documents as **partial sync**: [`history.list`](https://developers.google.com/gmail/api/reference/rest/v1/users.history/list) with `startHistoryId` to retrieve **only changes** since the last sync point, described as a **lighter-weight alternative** to full sync when the client has **recently synchronized** ([Synchronize clients with Gmail](https://developers.google.com/gmail/api/guides/sync)).

Today, OAuth Gmail installs already carry tokens and (for send) Gmail API usage elsewhere in the stack; incremental **read** still pays the full IMAP tax on every refresh.

---

## Direction

1. **Gmail-only fast path for `ripmail refresh` (forward / incremental)**  
   - Persist per-mailbox **`historyId`** (from `users.messages` / profile or last ingested message), alongside existing UID / `sync_state` for IMAP.  
   - **Happy path:** `history.list` with `startHistoryId` → map **messageAdded** / label changes → `messages.get` with `format=RAW` (or **minimal** + selective RAW) for new IDs only.  
   - **On HTTP 404** (history too old or unavailable): fall back to documented **full API sync** (`messages.list` + batched `messages.get`) or **existing IMAP forward path** until a new `historyId` checkpoint is established. Google documents history as **typically ≥ ~1 week** but **not guaranteed** ([sync guide — limitations](https://developers.google.com/gmail/api/guides/sync#limitations)).

2. **Keep IMAP for backward compatibility and heavy lifting**  
   - **`ripmail backfill`** / long historical clone / non-Gmail providers: **unchanged IMAP** (or provider-specific paths).  
   - Optional: first-time mailbox hydration stays IMAP or API **full sync** per product choice; partial sync is the win for **steady-state refresh**.

3. **Implementation hygiene**  
   - Reuse existing **Google OAuth** token plumbing (`ensure_google_access_token`, etc.). Confirm **Gmail API read scopes** align with [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) verification plan.  
   - **Batch** where appropriate ([batch requests](https://developers.google.com/gmail/api/guides/batch)); enable **gzip** + **`fields`** per [performance tips](https://developers.google.com/workspace/gmail/api/guides/performance).  
   - **Quota:** be mindful of per-method costs ([usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)); partial sync should reduce **list/search** churn vs repeated IMAP sessions.

4. **Observability**  
   - Extend `sync.log` / metrics: `gmail_api_partial`, `gmail_api_full_fallback`, `history_404`, message counts, phase durations — comparable to existing IMAP phase logs.

---

## Why this fits readonly indexing

- Partial sync is oriented around **deltas**, not reloading mailbox state via IMAP.  
- **Label / thread** semantics are native to the API; ingest can continue to normalize into the same SQLite + maildir (or RAW storage) model ripmail uses today.  
- **Writes** (archive, send) remain separate code paths; this OPP does not require migrating **mutations** to the API (and third-party reports suggest some **bulk modify** operations can be **slower** on the API than IMAP — out of scope unless measured).

---

## Risks and open questions

- **Dual sync path:** more branches to test; must prove **idempotent** ingest (same message ID → no duplicate rows).  
- **History gaps:** robust fallback must avoid “silent hole” in the index when 404 → partial path must complete full catch-up.  
- **Non-Gmail:** no change; IMAP only.  
- **Empirical win:** Google does not publish IMAP vs API **latency** tables; success = measured **p50/p95 refresh** on real mailboxes + unchanged correctness (eval / fixture tests).

---

## Suggested acceptance criteria

- [ ] After initial checkpoint, routine refresh uses **`history.list`** when history is valid; logs show API path.  
- [ ] **404 / expired history** triggers documented fallback and restores a valid `historyId`.  
- [ ] Backfill / `ripmail backfill` / initial long sync still use **IMAP** (or explicitly documented API full sync) — no regression for non-incremental flows.  
- [ ] Integration or unit tests cover: happy partial sync, 404 fallback, duplicate message idempotency.  
- [ ] Document env knobs / debug if needed (`RIPMAIL_GMAIL_REFRESH=api|imap` or similar) for support.

---

## References

- [Synchronize clients with Gmail](https://developers.google.com/gmail/api/guides/sync) — full vs partial sync, `historyId`, 404 → full sync  
- [Gmail API performance tips](https://developers.google.com/workspace/gmail/api/guides/performance)  
- [Usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)  
- Ripmail: [`ripmail/docs/SYNC.md`](../../ripmail/docs/SYNC.md), [`ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md) (IMAP checkpoint model)  
- OAuth / verification: [OPP-043](OPP-043-google-oauth-app-verification-milestones.md)
