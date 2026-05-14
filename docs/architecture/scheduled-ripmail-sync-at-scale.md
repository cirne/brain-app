# Scheduled ripmail refresh at scale (many tenants, one process)

**Status:** Recorded consideration — no implementation commitment.

How **periodic multi-tenant ripmail `refresh`** behaves today, why it becomes fragile when **thousands of workspaces** share **one long-lived Node/container**, and **directions** for a more robust scheduler. Complements **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)** (triggers, supervisor single-slot model), **[multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)** (cells, horizontal scale), and **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)** (exclusive lock: **one tenant hot in one container at a time**).

---

## Today (snapshot)

- **Server-wide sweep:** `startScheduledRipmailSync()` ([`scheduledRipmailSync.ts`](../../src/server/lifecycle/scheduledRipmailSync.ts)) runs on an interval from **`SYNC_INTERVAL_SECONDS`** (seconds), default **300**, via `getSyncIntervalMs()` ([`syncAll.ts`](../../src/server/lib/platform/syncAll.ts)).
- **All tenants on disk** are visited each tick (subject to onboarding/mail-config/defer guards). Work is **`syncInboxRipmail()`** → in-process **`refresh()`** for that tenant’s ripmail home.
- **Across tenants:** concurrency is capped (**`SCHEDULED_MAIL_SWEEP_CONCURRENCY`**, currently **4**).
- **Inside one tenant’s `refresh()`:** IMAP/Gmail, calendar, and Google Drive sources are scheduled as tasks with **`RIPMAIL_REFRESH_SOURCE_CONCURRENCY`** (currently **10**) — see [`src/server/ripmail/sync/index.ts`](../../src/server/ripmail/sync/index.ts).

This is simple and fine at **small N**. It does **not** encode tail-risk controls beyond fixed concurrency caps.

---

## The problem

Assume the **common case** is fast (seconds per tenant), but a **persistent minority** of refreshes are slow or stall — **~1%**, or more plausibly **~5%**, due to IMAP stalls, Google API latency spikes, large Drive deltas, SQLite contention, network partitions, or provider rate limiting.

Then:

1. **Fat tails eat capacity.** Fixed parallelism × interval caps how much wall-clock work you finish per sweep. A few **multi-minute** tenants consume slots; others **wait** or **miss** their intended cadence. The next interval starts while the previous sweep is still draining → **overlap**, **pile-up**, or **silent starvation** (some tenants rarely run).
2. **Thundering herd.** A fixed interval aligns tick boundaries — after deploys or maintenance, many tenants wake together unless you add **jitter** per tenant.
3. **Coupling to the API process.** Running thousands of refreshes (even bounded) in the same Node event loop as HTTP shares **CPU**, **memory**, **GC**, and **open handles**. Latency outliers on sync can widen **P99 request latency** unless sync is isolated or strictly capped.
4. **External quotas.** Concurrent Gmail/Drive/calendar traffic from **one container** multiplies by tenant count over time; **global** provider limits become the real scheduler.
5. **Operational déjà vu.** Batch jobs that “usually finish” but occasionally don’t are exactly where **nightly backups**, **cron sweeps**, and **maintenance tasks** fail in production: not the median, the **tail** and **overlap**.

The lesson from prior projects applies here: **design for the tail and for overlap**, not for the happy path.

---

## Properties we probably want

These are **design targets**, not commitments:

| Property | Rationale |
|----------|-----------|
| **Per-tenant fairness / SLA** | Avoid perpetual starvation when one tenant’s sync balloons. |
| **Admission control** | Hard caps on concurrent refreshes **per container**, **per provider**, and optionally **per tenant**. |
| **Isolation** | Prefer **worker processes/containers** (or at least **worker threads** + strict timeouts) so sync spikes don’t stall interactive serving. |
| **Explicit queues** | Durable or in-memory **queues** with visibility timeouts beat implicit “hope the sweep finishes.” |
| **Jittered schedules** | Spread `next_run_at` so tenants don’t align on the same second. |
| **Idempotent work** | Refresh should be safe to retry; record **lease / heartbeat** so crashed workers don’t wedge tenants. |
| **Observability** | Per-tenant **last success**, **duration histogram**, **reason for skip**, **provider errors**, **age of oldest pending** refresh. |

---

## Solution directions (pick/combine later)

**A. Queue + workers (classic scale-out)**  
Push “tenant X needs refresh” onto **SQS**, **Cloud Tasks**, **Temporal**, **Redis queue**, etc. Stateless **sync workers** pull jobs with **concurrency limits**, **visibility timeouts**, and **dead-letter** queues for poison tenants. The HTTP/API tier only **enqueues** (and serves interactive `POST /api/inbox/sync`).

**B. Per-tenant clocks instead of one global sweep**  
Replace “every 300s scan everyone” with **`next_refresh_at`** per tenant (DB or coordinator), **staggered** with random jitter. A lightweight **scanner** only picks tenants whose deadline passed — reduces redundant work when many tenants are idle.

**C. Tiered cadence**  
Active tenants (recent Hub/session/agent activity) refresh **often**; dormant tenants **less often**. Reduces load without sacrificing perceived freshness for engaged users.

**D. Separate lanes**  
**Interactive** refresh (user clicked sync, onboarding) bypasses or preempts **background** lane. Prevents background tails from blocking user-visible actions.

**E. Hard timeouts and circuit breakers**  
Per-source timeouts; after repeated failures, **back off** that tenant/source automatically (exponential backoff + max silence), surfacing status in Hub/onboarding instead of wedging the sweep.

**F. Align with cell / one-tenant-per-container model**  
At the **[multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)** extreme, **scheduled multi-tenant sweep inside one giant Node** disappears: each cell runs **O(1)** tenant work. That shifts the problem to **orchestrating many cells** — still needs queues and backoff at the control plane, but **local** contention drops.

**G. Rate-limit awareness**  
Centralize tokens for Google APIs / IMAP connections so parallel tenants don’t **amplify** shared quota errors.

---

## Sketch: sidecar refresh worker, queue, and non-overlapping cycles

*Product-direction notes (not implemented). Aligns with “fat tails and overlap are the failure mode.”*

**Exclusive tenancy.** In the hosted lifecycle model, a tenant’s **hot** data is intended to be **live on exactly one container at a time** (distributed lock — see **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)**). That constraint is useful for refresh design: you never need two containers blindly racing the same **`BRAIN_HOME`** on disk; coordination is about **which tenants are pinned to this host** and **fairness among them**, not split-brain on one tenant.

**Isolate from the web server.** Run mail/Drive/calendar refresh work in a **separate OS process** from the Hono/Vite **web app** (sidecar in the same pod/task definition, or a second container in the same task). That process **only** drains a **refresh queue**: enqueue tenant ids (or “refresh job” handles), a **fixed pool of concurrent workers** pulls jobs and runs `syncInboxRipmail` / equivalent under tenant context. The API tier handles interactive **`POST /api/inbox/sync`** (possibly enqueue **high priority** or run inline with tight caps — still TBD).

**Continual queue vs overlapping sweeps.** Prefer **always-on dequeuing** over “every 300s start a new sweep regardless of the last one.” A simple robust rule:

- Maintain **one logical “generation” or sweep** at a time for this worker fleet: enqueue **all** tenants due for refresh (or all tenants assigned to this pool).
- Workers drain until the queue is **empty**.
- **Only then** enqueue the **next** generation — **never** start a second full wave while the first is still running.

If draining takes **longer than the nominal cadence** (e.g. longer than today’s **five-minute** `SYNC_INTERVAL_SECONDS` default), **that is OK**: the cycle simply becomes **longer than five minutes**. **Log it prominently** (metrics: sweep duration, queue depth, slowest tenants, worker utilization). Operators then decide whether to **increase worker concurrency**, **shard tenants across more hosts**, or **move tenants** to another container/pool — rather than silently stacking overlapping intervals.

**Why this helps.** It replaces **pile-up** (timer fires while the previous sweep is mid-flight) with **predictable back-pressure**: one wave completes, then the next. Tail latency still stretches the **wave duration**, but you avoid **unbounded overlap** and make “we’re behind” a **single observable** (sweep wall time vs target).

**Caveats to validate later.** Worker count vs **Google/IMAP quotas**; whether generations should be **per-tenant jittered** inside the queue so all tenants don’t enqueue at once at wave start; interaction with **interactive** refresh when a background job is already running for the same tenant (**dedupe** or **lane priority**).

---

## Where to track work

- **Architecture:** this doc — problem statement, current behavior, failure modes, solution menu.
- **Opportunity:** **[OPP-115](../opportunities/OPP-115-multi-tenant-scheduled-mail-sync-at-scale.md)** — actionable backlog item when product/hosting commits to mega-tenant pools.

---

## Related code and docs

| Item | Notes |
|------|--------|
| [`scheduledRipmailSync.ts`](../../src/server/lifecycle/scheduledRipmailSync.ts) | Interval sweep, tenant concurrency |
| [`syncAll.ts`](../../src/server/lib/platform/syncAll.ts) | `syncInboxRipmail`, `getSyncIntervalMs` |
| [`ripmail/sync/index.ts`](../../src/server/ripmail/sync/index.ts) | Source-level parallelism inside `refresh()` |
| [background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md) | Triggers, supervisor, multi-tenant caveats |
| [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md) | Cells, scaling phases |
| [cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md) | One tenant hot per container (lock); transitions |
| [multi-container-architecture.md](./multi-container-architecture.md) | Tenant load balancing across containers — background sync is one pillar |

---

*Written as forward-looking design notes; validate against future hosting topology before implementing.*
