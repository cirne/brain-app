# BUG-057: Ripmail refresh/backfill — reliability, observability, and UI truth

**Status:** **Archived (2026-05-15).** Server/API/sync slice shipped: truthful Hub **`needsBackfill` / `lastUid`**, **`jobId`** on Hub backfill enqueue, Gmail bootstrap widened (~1y list), structured **`lane` / `phase`** logs, **`ripmail:refresh:completed`** includes **`lane`**, systemic Gmail fetch failure surfaces **`result.error`** without advancing sync state, and absurd far-future **`messages.date`** values no longer drive **`statusParsed` dateRange**. Regression coverage: `gmail-sync.bug057.test.ts`, `hubRipmailSourceStatus*.test.ts`, `hub.test.ts`, `status.test.ts`.

**Not closed in this archive (follow-up / OPP material):** Hub **copy** (refresh vs sync vs backfill), **concurrent-lane UI**, **unified “last updated”** formatting across overview vs drill-down, **settings panel IA**, and **surfacing backfill failure to the user** beyond **`jobId`** + logs (e.g. poll last error, toast). Track as product/UX work or a new bug if prioritized.

**Tags:** `ripmail` · `mail` · `hub` · `sync` · `observability` · `staging` · `ux` · `copy`  

**Related:** Gmail historical path (`sync/gmail.ts`), IMAP path (`sync/imap.ts`), Hub spawn (`hubRipmailSpawn.ts`), Hub status synthesis (`hubRipmailSourceStatus.ts`). Recent fixes: attachment MIME on rebuild; IMAP Hub backfill now clears `sync_state` when `historicalSince` is set.

---

## Resolution (2026-05-15)

| Area | Change |
|------|--------|
| **`getHubSourceMailStatus`** | `needsBackfill` from **`gmailOAuthHistoricalBackfillPending`** (Gmail OAuth) or **`deepHistoricalPending` + indexed count** fallback; **`lastUid`** from **`sync_state`** for non–Gmail-OAuth IMAP. [`hubRipmailSourceStatus.ts`](../../../src/server/lib/hub/hubRipmailSourceStatus.ts) |
| **`POST /api/hub/sources/backfill`** | Returns **`{ ok: true, jobId }`**; spawn failures log with **`jobId`**. [`hub.ts`](../../../src/server/routes/hub.ts) |
| **Gmail without `historyId`** | Bootstrap listing uses ~**1y** window (paginated), not ~7d single-page. [`gmail.ts`](../../../src/server/ripmail/sync/gmail.ts) |
| **Logs** | **`lane`** on historical list, bootstrap **`ripmail:gmail:list-phase`** (`phase: 'list'`), **`message-fetch-error`** payloads; **`ripmail:refresh:completed`** includes **`lane`**. |
| **Gmail systemic fetch failure** | **`fetchFailures`**, **`result.error`** when all **`messages.get`** fail; skips profile/update/mark-first-backfill. |
| **`statusParsed` dates** | Ignores **`MAX(date)`** rows after **2100-01-01** for bounds. [`status.ts`](../../../src/server/ripmail/status.ts) |

---

## Summary

Mail **refresh** and **backfill** are hard to reason about in production: failures can be **silent** to the user, **logs** lack a consistent correlation story (tenant, source, lane, phases, counts), and **Hub / UI** fields can imply health or completion that the database contradicts (e.g. **~1 week** of indexed dates while “needs backfill” reads false).

We need **higher reliability** (clear failure modes, retries, no fire-and-forget without surfaced outcome), **structured logging** that operators can query (e.g. New Relic), and **UI + API** that reflect **ground truth** from SQLite and sync semantics.

Separately, **user-facing surfaces** mix **refresh**, **sync**, and **backfill** without a shared vocabulary; **overview vs mailbox drill-down** disagree on how “last sync” is phrased and timed; and **long-running early phases** (connecting, UID listing) are not surfaced as distinct states even though the backend can run **refresh and historical backfill concurrently**.

---

## Usability / UI consistency

*(Preserved spec; UX items above remain optional follow-up.)*

### Terminology: refresh vs sync vs backfill

Ripmail can perform **more than one kind of mail work** at once (e.g. incremental **refresh** while a **historical window** job runs). The UI should not overload a single word (“sync”) for all of it without explanation.

| Concept (implementation) | Problem today | Direction |
|--------------------------|---------------|-----------|
| **Refresh** | Used in copy (“Refresh pulls new mail…”) but elsewhere the product says **sync**. | Pick **one umbrella term for users** (e.g. “Updating mail” / “Catch up”) **or** consistently pair labels: **“Recent mail”** vs **“Older mail (chosen window)”**. Avoid **sync** meaning refresh in one place and “everything” in another. |
| **Sync** | Overview: “Sync mail now”; drill-down: “Last sync \<date\>”; button: “Retry **sync** (backfill)”. | **Same metric, same wording**: e.g. **“Last refreshed”** + timestamp vs relative time, chosen once and reused on **What’s running** and **mailbox settings**. |
| **Backfill** | Jargon; “Backfill window” assumes users know what backfill is. | User-facing label should describe **outcome** (“Download older mail — **1 year**”) not pipeline jargon. Internal docs/API can keep **backfill** / **historicalSince**. |

### Concurrent lanes in the UI

The product **allows refresh and backfill to run together**. The UI must show **which lanes are active** (and ideally phase), not a single binary “syncing” flag that hides one of them.

- **Minimum:** Two explicit indicators or one compound line, e.g. “Updating new mail…” and “Downloading older mail (to May 2024)…” with separate completion/error.
- **Avoid:** One “Sync mail now” affordance on the overview while the drill-down only exposes **backfill** retry — users cannot tell if **refresh** is idle, queued, or running.

### Cross-surface inconsistency (“last sync”)

Observed mismatch:

- **Mailbox drill-down (Settings / connector panel):** **“Last sync”** with a **calendar date** (static-feeling).
- **Hub overview (“What’s running”):** **“Last synced just now”** (relative).

These should use the **same field**, **same formatting rules** (relative vs absolute), and **same definition** (last successful **refresh** completion? last **any** mail job? — pick one and document it in API + copy). If they intentionally measure different events, the **labels must differ** so users are not comparing apples to oranges.

### Settings panel layout and primary actions

The **backfill window** control and **retry** action should be **grouped and hierarchically clear**: what you’re asking for (window), what will happen (long-running historical download), and **where status appears** (not only a line at the top that says “Last sync”). Consider **redoing this panel** so status + actions read top-to-bottom as one story (indexed range → what’s running → what you can trigger).

### Missing lifecycle states (especially at start)

Before messages appear in bulk, work can sit in **initialization**: connector handshake, folder selection, **UID list / enumeration** on large mailboxes, etc. That can take a long time but currently reads like **idle** or a vague “sync.”

We need **distinct, honest states** exposed to UI (and ideally logs), for example:

- **Connecting** / **Preparing**
- **Listing messages on server** (or “Scanning mailbox…” when UID download dominates)
- **Fetching message bodies** / **Indexing**
- **Idle** (success or paused) vs **Failed** (with retry)

This bug originally under-emphasized these **early phases**; they are part of **accurate sync status**, not only “count went up.”

---

## Symptoms observed

1. **Indexed date range ~7 days** with hundreds of messages, while user expects a **1y** (or similar) window after Hub backfill.
2. **Hub source status JSON** showed `needsBackfill: false` and `lastUid: null` even when the mailbox was **not** historically complete — those values were **artifacts of synthetic JSON**, not derived from `source_sync_meta` / `sync_state`.
3. **Staging:** `POST /api/hub/sources/backfill` kicks work via **`void spawn…`** — errors go to **`console.error`** only; the HTTP response is **`{ ok: true }`** before work finishes, so the UI cannot know **success vs failure** from that response alone.
4. **Operators:** Distinguishing “refresh lane” vs “backfill lane”, **Gmail** `historical-list` vs **IMAP** full re-pull, and **partial failure** (e.g. many `gmail:message-fetch-error`) requires grep/NRQL gymnastics.
5. **Copy overload:** Explainer uses **Refresh** / **Backfill**, while the primary button says **“Retry sync (backfill)”** — **sync** is ambiguous vs **refresh** in the same panel.
6. **Overview vs drill-down:** **Last sync** presentation differs (**date** vs **“just now”**), undermining trust that the UI reflects one backend truth.
7. **No concurrent lane UX:** When **refresh** and **historical pull** can both run, the UI does not consistently show **both** activities (or which failed).
8. **Long “silent” startup:** Initial connection / **UID-heavy** phases do not appear as a **distinct** user-visible state.
9. **Indexed range anomalies:** Extreme or placeholder **date range** end values in the drill-down (e.g. far-future year) worsen the sense that status is unreliable (may be separate data bug; still hurts UX until fixed).

---

## Root cause / design gaps (known)

| Gap | Notes |
|-----|--------|
| **Gmail default without `historyId`** | Uses **~7d**, **single-page** `messages.list` for the “recent” bootstrap — easy to stay in a **short window** if historical backfill never succeeds or isn’t run. |
| **Hub `getHubSourceMailStatus`** | Synthesizes **`mailboxes[]`** with only counts + global date range; **omits** `needsBackfill` / `lastUid` → parsed as false/null → **misleading API contract**. |
| **Backfill spawn** | Fire-and-forget; no durable job id, no user-visible error channel tied to the button click. |
| **Logging** | Many lines are useful but **not consistently structured** with `sourceId`, `ripmailHome`/tenant, `lane` (`refresh` vs `backfill`), phase (`list` / `fetch` / `persist`), and **progress numerator/denominator** in one place. |
| **UI** | Copy and controls (“1 year” backfill) imply behavior that depends on **Gmail vs IMAP** and on **token/state**; user sees **sync idle** while reality is “stuck in short window” or “backfill failed”. |
| **Terminology / information architecture** | **Refresh**, **sync**, and **backfill** are used interchangeably across **Hub overview**, **mailbox panel**, and **Settings**; users cannot map labels to behavior. |
| **Surface divergence** | **What’s running** card and **per-source drill-down** likely read **different props or formatters** for “last updated” without a single SSOT string rule. |
| **Status model** | UI lacks a **phase machine** aligned with backend (idle → connect → list UIDs → fetch → persist); early phases collapse to “nothing happening.” |
| **Concurrent work** | Backend allows overlapping work; UI model is often **single busy flag** or **single last-run timestamp**. |

---

## Expected behavior

1. **API honesty:** Hub mail status (and any derivative UI) uses **DB-backed** fields: e.g. `gmailOAuthHistoricalBackfillPending` / `first_backfill_completed_at`, per-source **message date bounds**, **IMAP `last_uid`** per folder when relevant, explicit **`historicalSince` last attempted** / outcome if we store it.
2. **User-visible outcomes:** Enqueueing **historical mail download** (and refresh, when manually triggered) yields **ack + trackable job** or **polling** endpoint, or **SSE/WS** progress — not only `{ ok: true }` before work finishes. Errors surface in **UI** (toast / inline) with **actionable** text (OAuth missing, quota, partial completion).
3. **Logging contract:** Every refresh/backfill run logs a **start** and **end** (duration, messagesAdded/Updated, error) with **`sourceId`**, **`historicalSince`** when set, and **lane**. Gmail: log **listed** vs **fetched** vs **persisted** counts where feasible. Align with New Relic queries (`entity.guid` for staging).
4. **Reliability:** Define behavior for **partial** historical pulls (resume? marker in DB?), **stale locks** on crash, and **rate limits** (Gmail API) without appearing “stuck” with no logs.
5. **User vocabulary:** Product copy uses **plain language** for the historical job (not “backfill” unless defined once in UI). **Refresh** vs **historical download** (or agreed synonyms) are stable across overview + drill-down + errors.
6. **Unified timestamps:** **One definition** of “last successful refresh” / “last mail activity” exposed from API; **all** mail surfaces use the same formatter policy (relative vs absolute).
7. **Lane-aware status:** API + UI expose **active lanes** (and phase when possible) so **refresh + historical** overlap is visible; errors attach to the **lane** that failed.
8. **Early-phase visibility:** **Connecting / listing / fetching** are real UI states backed by server truth (not spinner-only guesses).

---

## Code map (starting points)

| Area | File(s) |
|------|---------|
| Refresh orchestration | [`src/server/ripmail/sync/index.ts`](../../../src/server/ripmail/sync/index.ts) |
| Gmail list / fetch | [`src/server/ripmail/sync/gmail.ts`](../../../src/server/ripmail/sync/gmail.ts) |
| IMAP fetch | [`src/server/ripmail/sync/imap.ts`](../../../src/server/ripmail/sync/imap.ts) |
| Hub backfill HTTP | [`src/server/routes/hub.ts`](../../../src/server/routes/hub.ts) (`POST /sources/backfill`) |
| Hub spawn | [`src/server/lib/hub/hubRipmailSpawn.ts`](../../../src/server/lib/hub/hubRipmailSpawn.ts) |
| Hub status synthesis | [`src/server/lib/hub/hubRipmailSourceStatus.ts`](../../../src/server/lib/hub/hubRipmailSourceStatus.ts) |
| Status / date range | [`src/server/ripmail/status.ts`](../../../src/server/ripmail/status.ts) |
| Backfill completion meta | [`src/server/ripmail/sync/persist.ts`](../../../src/server/ripmail/sync/persist.ts) (`markFirstBackfillCompleted`, `gmailOAuthHistoricalBackfillPending`) |
| Hub connector UI | [`src/client/components/hub-connector/HubConnectorMailSections.svelte`](../../../src/client/components/hub-connector/HubConnectorMailSections.svelte), [`HubConnectorSourcePanel.svelte`](../../../src/client/components/hub-connector/HubConnectorSourcePanel.svelte) |
| Hub overview (“What’s running”) | [`src/client/components/hub/HubActivityOverview.svelte`](../../../src/client/components/hub/HubActivityOverview.svelte); strings [`src/client/lib/i18n/locales/en/hub.json`](../../../src/client/lib/i18n/locales/en/hub.json) (`heading`, mail row **sync** copy) |

---

## Fix direction (suggested phases)

*(Historical; superseded by Resolution table above for the shipped slice.)*

1. **Truthful status:** Extend `getHubSourceMailStatus` to populate **`needsBackfill`** from real rules (Gmail pending meta + indexed breadth heuristics if needed), and **`lastUid`** (or “N/A for Gmail API”) from `sync_state` for IMAP sources. Document fields in API responses.
2. **Structured logs:** Add `ripmail:refresh:lane-start` / `lane-complete` (or equivalent) with consistent attributes; ensure **WARN/ERROR** always include `sourceId` and lane.
3. **Backfill UX + reliability:** Return **job id** or block until timeout with **202 + poll**; log and optionally persist **last error** per source for UI.
4. **Gmail bootstrap:** Revisit **7d / single-page** default so “refresh” doesn’t silently cap history when `historyId` is missing (may overlap this bug or spawn OPP).
5. **IA / panel redesign:** Restructure mailbox Settings so **status** (lanes + phases + last successful refresh) sits with **actions** (catch-up vs historical window); align **button labels** with the explainer (remove mixed **sync/backfill** unless terms are defined once).
6. **Copy pass:** Follow [`docs/COPY_STYLE_GUIDE.md`](../../COPY_STYLE_GUIDE.md); define **Braintunnel**-accurate, deployment-neutral strings for **overview + drill-down** in one pass (i18n keys in `hub.json` and connector namespaces).

---

## Non-goals (initially)

- Full **migration** system for mail schema (early-dev convention remains: schema bump can force rebuild).
- **Guarantee** parity between “selected 1y in UI” and **exact** IMAP server semantics without IMAP `SINCE` search (IMAP may remain “full folder re-pull” when clearing cursors).

---

## Verification (when addressed)

- Integration or e2e: Hub backfill **failure** (revoked token) surfaces in UI/API, not only server logs.
- NRQL: single query filters **`ripmail:*`** by `sourceId` and sees **start/complete** for one backfill.
- Manual: indexed **earliestDate** moves backward after successful 1y Gmail historical pull; status **`needsBackfill`** matches `source_sync_meta` expectation.
- Copy: **Overview** and **mailbox drill-down** show **consistent** “last updated” semantics and formatting; no mismatched **sync** vs **refresh** vs **backfill** without a single gloss.
- UX: With **refresh + historical** both running, UI shows **both** lanes (or an explicit combined summary that cannot lie about idle).
- UX: During **long UID/list phase**, user sees a **non-idle** state distinct from **fetching bodies** / **indexing**.
