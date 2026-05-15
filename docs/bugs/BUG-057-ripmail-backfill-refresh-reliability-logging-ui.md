# BUG-057: Ripmail refresh/backfill — reliability, observability, and UI truth

**Status:** Open  
**Tags:** `ripmail` · `mail` · `hub` · `sync` · `observability` · `staging`  

**Related:** Gmail historical path (`sync/gmail.ts`), IMAP path (`sync/imap.ts`), Hub spawn (`hubRipmailSpawn.ts`), Hub status synthesis (`hubRipmailSourceStatus.ts`). Recent fixes: attachment MIME on rebuild; IMAP Hub backfill now clears `sync_state` when `historicalSince` is set.

---

## Summary

Mail **refresh** and **backfill** are hard to reason about in production: failures can be **silent** to the user, **logs** lack a consistent correlation story (tenant, source, lane, phases, counts), and **Hub / UI** fields can imply health or completion that the database contradicts (e.g. **~1 week** of indexed dates while “needs backfill” reads false).

We need **higher reliability** (clear failure modes, retries, no fire-and-forget without surfaced outcome), **structured logging** that operators can query (e.g. New Relic), and **UI + API** that reflect **ground truth** from SQLite and sync semantics.

---

## Symptoms observed

1. **Indexed date range ~7 days** with hundreds of messages, while user expects a **1y** (or similar) window after Hub backfill.
2. **Hub source status JSON** showed `needsBackfill: false` and `lastUid: null` even when the mailbox was **not** historically complete — those values were **artifacts of synthetic JSON**, not derived from `source_sync_meta` / `sync_state`.
3. **Staging:** `POST /api/hub/sources/backfill` kicks work via **`void spawn…`** — errors go to **`console.error`** only; the HTTP response is **`{ ok: true }`** before work finishes, so the UI cannot know **success vs failure** from that response alone.
4. **Operators:** Distinguishing “refresh lane” vs “backfill lane”, **Gmail** `historical-list` vs **IMAP** full re-pull, and **partial failure** (e.g. many `gmail:message-fetch-error`) requires grep/NRQL gymnastics.

---

## Root cause / design gaps (known)

| Gap | Notes |
|-----|--------|
| **Gmail default without `historyId`** | Uses **~7d**, **single-page** `messages.list` for the “recent” bootstrap — easy to stay in a **short window** if historical backfill never succeeds or isn’t run. |
| **Hub `getHubSourceMailStatus`** | Synthesizes **`mailboxes[]`** with only counts + global date range; **omits** `needsBackfill` / `lastUid` → parsed as false/null → **misleading API contract**. |
| **Backfill spawn** | Fire-and-forget; no durable job id, no user-visible error channel tied to the button click. |
| **Logging** | Many lines are useful but **not consistently structured** with `sourceId`, `ripmailHome`/tenant, `lane` (`refresh` vs `backfill`), phase (`list` / `fetch` / `persist`), and **progress numerator/denominator** in one place. |
| **UI** | Copy and controls (“1 year” backfill) imply behavior that depends on **Gmail vs IMAP** and on **token/state**; user sees **sync idle** while reality is “stuck in short window” or “backfill failed”. |

---

## Expected behavior

1. **API honesty:** Hub mail status (and any derivative UI) uses **DB-backed** fields: e.g. `gmailOAuthHistoricalBackfillPending` / `first_backfill_completed_at`, per-source **message date bounds**, **IMAP `last_uid`** per folder when relevant, explicit **`historicalSince` last attempted** / outcome if we store it.
2. **User-visible outcomes:** “Retry sync (backfill)” yields **ack + trackable job** or **polling** endpoint, or **SSE/WS** progress — not only `{ ok: true }` on enqueue. Errors surface in **UI** (toast / inline) with **actionable** text (OAuth missing, quota, partial completion).
3. **Logging contract:** Every refresh/backfill run logs a **start** and **end** (duration, messagesAdded/Updated, error) with **`sourceId`**, **`historicalSince`** when set, and **lane**. Gmail: log **listed** vs **fetched** vs **persisted** counts where feasible. Align with New Relic queries (`entity.guid` for staging).
4. **Reliability:** Define behavior for **partial** historical pulls (resume? marker in DB?), **stale locks** on crash, and **rate limits** (Gmail API) without appearing “stuck” with no logs.

---

## Code map (starting points)

| Area | File(s) |
|------|---------|
| Refresh orchestration | [`src/server/ripmail/sync/index.ts`](../../src/server/ripmail/sync/index.ts) |
| Gmail list / fetch | [`src/server/ripmail/sync/gmail.ts`](../../src/server/ripmail/sync/gmail.ts) |
| IMAP fetch | [`src/server/ripmail/sync/imap.ts`](../../src/server/ripmail/sync/imap.ts) |
| Hub backfill HTTP | [`src/server/routes/hub.ts`](../../src/server/routes/hub.ts) (`POST /sources/backfill`) |
| Hub spawn | [`src/server/lib/hub/hubRipmailSpawn.ts`](../../src/server/lib/hub/hubRipmailSpawn.ts) |
| Hub status synthesis | [`src/server/lib/hub/hubRipmailSourceStatus.ts`](../../src/server/lib/hub/hubRipmailSourceStatus.ts) |
| Status / date range | [`src/server/ripmail/status.ts`](../../src/server/ripmail/status.ts) |
| Backfill completion meta | [`src/server/ripmail/sync/persist.ts`](../../src/server/ripmail/sync/persist.ts) (`markFirstBackfillCompleted`, `gmailOAuthHistoricalBackfillPending`) |
| Hub connector UI | [`src/client/components/hub-connector/HubConnectorMailSections.svelte`](../../src/client/components/hub-connector/HubConnectorMailSections.svelte), [`HubConnectorSourcePanel.svelte`](../../src/client/components/hub-connector/HubConnectorSourcePanel.svelte) |

---

## Fix direction (suggested phases)

1. **Truthful status:** Extend `getHubSourceMailStatus` to populate **`needsBackfill`** from real rules (Gmail pending meta + indexed breadth heuristics if needed), and **`lastUid`** (or “N/A for Gmail API”) from `sync_state` for IMAP sources. Document fields in API responses.
2. **Structured logs:** Add `ripmail:refresh:lane-start` / `lane-complete` (or equivalent) with consistent attributes; ensure **WARN/ERROR** always include `sourceId` and lane.
3. **Backfill UX + reliability:** Return **job id** or block until timeout with **202 + poll**; log and optionally persist **last error** per source for UI.
4. **Gmail bootstrap:** Revisit **7d / single-page** default so “refresh” doesn’t silently cap history when `historyId` is missing (may overlap this bug or spawn OPP).

---

## Non-goals (initially)

- Full **migration** system for mail schema (early-dev convention remains: schema bump can force rebuild).
- **Guarantee** parity between “selected 1y in UI” and **exact** IMAP server semantics without IMAP `SINCE` search (IMAP may remain “full folder re-pull” when clearing cursors).

---

## Verification (when addressed)

- Integration or e2e: Hub backfill **failure** (revoked token) surfaces in UI/API, not only server logs.
- NRQL: single query filters **`ripmail:*`** by `sourceId` and sees **start/complete** for one backfill.
- Manual: indexed **earliestDate** moves backward after successful 1y Gmail historical pull; status **`needsBackfill`** matches `source_sync_meta` expectation.
