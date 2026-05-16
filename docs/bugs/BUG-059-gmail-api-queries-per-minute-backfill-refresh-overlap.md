# BUG-059: Gmail REST sync — **`Queries per minute per user`** during backfill (overlapping refresh + high **`messages.get`** concurrency)

**Status:** **Open**

**Tags:** `ripmail` · `mail` · `gmail` · `sync` · `quota` · `hub` · `observability`

**Related:** [BUG-057 (archived) — backfill/refresh reliability & logging](archive/BUG-057-ripmail-backfill-refresh-reliability-logging-ui.md) · [`src/server/ripmail/sync/gmail.ts`](../../src/server/ripmail/sync/gmail.ts) · [`src/server/ripmail/sync/syncConcurrency.ts`](../../src/server/ripmail/sync/syncConcurrency.ts) · [`src/server/ripmail/sync/index.ts`](../../src/server/ripmail/sync/index.ts) · [`src/server/lifecycle/scheduledRipmailSync.ts`](../../src/server/lifecycle/scheduledRipmailSync.ts) · [`src/server/routes/hub.ts`](../../src/server/routes/hub.ts) · [`src/server/lib/hub/hubRipmailSpawn.ts`](../../src/server/lib/hub/hubRipmailSpawn.ts)

---

## Summary

Gmail OAuth mail sync uses the **Gmail REST API** (`history.list` / `messages.list` / `messages.get` with `format: 'raw'`). Under load—especially **historical backfill**—Google returns **429 / quota errors** such as:

> Quota exceeded for quota metric **'Queries'** and limit **'Queries per minute per user'** of service **'gmail.googleapis.com'** …

Logs show **`ripmail:gmail:message-fetch-error`** with **`lane: "backfill"`** and **`lane: "refresh"`** **interleaved at the same timestamps** for the same **`sourceId`**. In this codebase, **`backfill` vs `refresh`** is chosen **per `refresh()` invocation** from whether **`historicalSince`** was passed into `syncGmailSource`—so **interleaved lanes strongly indicate two overlapping sync runs** hitting the **same Gmail user quota** concurrently, not a single orderly pipeline.

Separately from debugging this bug, **product intent** is *not* to slow everything down uniformly: **recent mail should download quickly** (high parallelism where the API budget allows); **deep history** can use a **slower, quota-safe** lane. Prefer **REST** for the fast path—the team wants to avoid spending **45s+** just enumerating IDs when a better-strategy **`messages.list`** (or **`history`**-driven incremental) keeps “what’s recent” responsive.

---

## Symptoms

- Repeated **`Quota exceeded`** on **`Queries per minute per user`** (`gmail.googleapis.com`) during large pulls.
- WARN logs: **`ripmail:gmail:message-fetch-error`** including **`lane: "backfill"`** *and* **`lane: "refresh"`** nearly simultaneously for one mailbox.
- Partial indexing: many messages skipped for a run; downstream “not all mail present” UX.

---

## Likely root causes

### 1. Overlapping **refresh** and **backfill** (same OAuth user → same quota)

- **Hub backfill** (`POST /api/hub/sources/backfill`) schedules work with **`historicalSince`** via **`spawnRipmailBackfillSource`** (**fire-and-forget**).
- **Scheduled periodic sync** (`scheduledRipmailSync.ts`) runs **`syncInboxRipmail()`** (no **`historicalSince`**) whenever onboarding is past **`not-started` / `indexing`** — it **does not** defer when **`backfillRunning`** is true for that tenant/mail status.
- **Manual inbox sync** paths can also **`void`** kicks that overlap ongoing work.

**Effect:** Two independent executions each run **`messages.get`** with concurrency **`GMAIL_MESSAGES_GET_CONCURRENCY` (currently 8)**, doubling burst rate against **per-minute-per-user** limits.

### 2. **One `messages.get` per message** × **historical lists**

Historical mode **`messages.list`** with `q: after:<epoch>` aggregates many IDs; each ID then triggers **`messages.get`** — **quota scales with messages**, not “one bulk download.”

### 3. **Global/source-level parallelism elsewhere**

**`RIPMAIL_REFRESH_SOURCE_CONCURRENCY`** allows many sources’ tasks — less relevant per single Gmail mailbox, but can matter multi-account.

### 4. **GCP project quota / Google-side limits**

Less common than (1)+(2): project default quotas tightened, or **`per user`** budget is smaller than throughput implied by parallelism.

---

## Desired behavior (product / architecture)

These constraints should guide fixes—**avoid “turn the dial down” everywhere**:

1. **Fast path — recent mail:** Maximize throughput **within Gmail API rules** for “what the user cares about today” — **prefer REST**, **prefer higher parallelism** for incremental / short-window fetch, **`history.list`** where **`historyId`** is valid so we are not redoing **`messages.list`** over huge windows unnecessarily.
2. **Avoid multi‑tens‑of‑seconds purely to discover recent IDs:** If **`messages.list`** pagination is dominating wall time for the **recent** slice, treat that as a **design smell** (query shape, windowing, or history usage)—**do not** slow the whole product to work around listing slowness without trying cheaper discovery first.
3. **Slow path — deep history:** After recent mail is “good enough,” **transition** to a **throttled, reliable** backfill: lower **`messages.get`** concurrency, **serialized** against competing refresh work, **backoff on 429**, optional **smaller time chunks** / resume checkpoints, and clear **UI “catching up older mail”** state (see archived BUG-057 concurrent-lane UX notes).

**Net:** **REST stays** for OAuth Gmail; **two-phase strategy** (fast recent + slow history) is the target shape, not switching wholesale to IMAP for quota relief.

---

## Potential solutions (implementation directions)

| Direction | What it does | Tradeoffs |
|-----------|----------------|-----------|
| **Mutex / queue per Gmail OAuth identity** | Ensure at most one **Gmail sync** “flight group” per user: coalesce refresh+backfill or run them strictly serial. | Simplest fix for overlap; must not **block** the fast path forever behind a multi-hour backfill without **priority** (recent first). |
| **Defer scheduled refresh while backfill active** | If **`backfillRunning`** (or lock row / in-process flag), skip or delay **`syncInboxRipmail()`** for that tenant. | Reduces overlap; still need mutex if **hub refresh** + **hub backfill** both fire. |
| **429-aware throttle** | On quota errors: exponential backoff, temporarily lower concurrency, resume. | Improves reliability; does not fix root overlap alone. |
| **Lower `GMAIL_MESSAGES_GET_CONCURRENCY` for historical lane only** | Keep high concurrency for **incremental** / small ID sets; cap backfill. | Matches “fast recent, slow history” without punishing normal refresh. |
| **Batch HTTP / request coalescing** | Gmail **batch** endpoints may reduce HTTP overhead; **quota often still counts inner requests** — verify in Google docs before betting on big wins. | Marginal for “queries per user” if each inner call still counts. |
| **Chunked historical list + pause** | Page **`messages.list`**, fetch N messages, **sleep** to stay under per-minute budget. | Slower backfill wall time; predictable. |
| **Request higher quotas in GCP** | If legitimately under-provisioned for product volume. | Process + may not remove need for client-side fairness. |

---

## Verification / observability

- NRQL / logs: correlate **`ripmail:gmail:message-fetch-error`** **`lane`** with **`jobId`** / **`ripmail:refresh:completed`** **`lane`** and **timestamps** to confirm **overlap**.
- Add (if missing) a **single structured field** for “in-flight Gmail sync generation” or **mutex holder** to prove serialization.
- Reproduce: start **Hub backfill** on a large mailbox, wait for **scheduled mail** tick (or trigger **`POST /api/inbox/sync`**), watch for **interleaved** **`backfill` / `refresh`** fetch errors.

---

## Open questions

- Should **Hub “refresh this source”** preempt **backfill** or queue behind it?
- Do we expose **explicit “pause deep history”** for power users when quota is tight?
- Does Google’s **per-user** budget differ enough by workspace / account type that we need **adaptive** concurrency from response headers?
