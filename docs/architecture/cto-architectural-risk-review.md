# CTO architectural risk review

**Date:** 2026-05-16. **Posture:** fresh outside lens; early dev (~tens of users), pre-revenue. **Status:** opinion, not policy — written to surface decisions the team should make *now*, while the cost of fixing them is hours-to-days rather than weeks-to-months. Companion to [SECURITY.md](../SECURITY.md) (security-specific risks) and [ARCHITECTURE.md](../ARCHITECTURE.md) (system map). Does **not** repeat the items already tracked there unless a CTO-level reframing changes their priority.

---

## Framing

Braintunnel has many of the right early bets:

- **Directory-per-tenant** is well-defended and aligns desktop + cloud under one codebase — [per-tenant-storage-defense.md](./per-tenant-storage-defense.md), [deployment-models.md](./deployment-models.md).
- **AsyncLocalStorage tenant context** + path jailing — clean, testable, defensible. [SECURITY.md § Tenant filesystem isolation](../SECURITY.md#tenant-filesystem-isolation).
- **Single codebase, two storage/auth shapes** — strategically sharp; cheap to maintain so long as the *seams* stay clean.
- **A real SECURITY.md** at <20 users — most early-stage products do not have one. Keep it.
- **"No backwards compatibility" + clean-break culture during early dev** — correct *for now*. The risk is not the rule; it is the **silent assumption that the rule will keep working** as users arrive.

This document focuses on a different question: **what decisions are cheap to revisit today that become expensive, painful, or impossible to revisit once we have paying users, B2B partners, or regulators?** These are ordered by `severity × irreversibility`, not by perceived urgency.

---

## Tier 1 — Irreversible if we wait

### R1. Schema bumps wipe primary data — including data we cannot recreate

**What:** Three SQLite stores follow a "delete the file on schema version mismatch" pattern:

- [`tenantSqlite.ts:117-131`](../../src/server/lib/tenant/tenantSqlite.ts) — `var/brain-tenant.sqlite` (chat history, notifications, B2B session state).
- [`brainGlobalDb.ts:131-144`](../../src/server/lib/global/brainGlobalDb.ts) — `brain-global.sqlite` (B2B grants, custom policies, **Slack workspace bot tokens**, Slack user links, cold-query rate-limit windows).
- [`ripmail/schema.ts:1-9`](../../src/server/ripmail/schema.ts) — `ripmail.db` (mail index, FTS, sync state, drafts).

The mail DB is at `SCHEMA_VERSION = 32`; the global DB is at `12` and ticks roughly once per Slack/B2B feature. Each bump is currently an explicit destructive event.

**Why this is fine today:** AGENTS.md says "no migrations during early dev." Most data is recreatable: mail re-syncs from Gmail, chat history is the user's own conversation log they will not miss.

**Why this is a Tier 1 risk:** As soon as we ship anything to anyone:

- **Slack workspace bot tokens** in `slack_workspaces` are issued once per install by Slack OAuth; we cannot regenerate them without re-walking the admin install flow per workspace. A schema bump silently uninstalls every Slack integration we have ever shipped.
- **B2B grants** (`brain_query_grants`) are trust statements between users. Wiping them on deploy is a trust-network outage that re-issuing does not repair (the asker has to re-consent).
- **Mail re-sync from Gmail** is rate-limited. A staging-scale 1 GB / 50k-message inbox takes ~10–20 minutes; at 100 tenants on one cell that is hours of degraded service per deploy, and Gmail per-user quotas can stall it entirely.
- **Chat history is the product memory** — wiping it is the kind of incident that ends free-trial conversion.

**Why now:** The cost to introduce a forward-only migration runner is a single afternoon — `better-sqlite3` already exposes `db.transaction` and `PRAGMA user_version`. We have **four** schemas worth of `CREATE TABLE` to baseline (`tenant`, `global`, `ripmail`, `agentDiagnostics`). Every additional ad-hoc bump that ships before the runner exists adds another "baseline state we must understand later." Today there are zero historical schemas in the wild that we owe migrations to; that number is monotonically non-decreasing.

**Suggested direction:** Migration framework before the next user-visible release. Concrete shape (not a spec):

```
migrations/
  global/0001-initial.sql ... 0012-slack-user-settings.sql
  tenant/0001-initial.sql ...
  ripmail/0001-initial.sql ...
```

`openTenantDbAtPath` becomes `apply(db, target_version, migrations[])`. For DBs already on the latest version this is a no-op. Two-way doors: keep the destructive path under an `if (allowResetOnSchemaSkew && isDev)` guard so we keep dev velocity, but **production never deletes on skew**.

This is the single most important item in this document.

---

### R2. No idempotency keys on cross-system or cross-tenant writes

**What:** Several write paths cross trust boundaries the application does not control retry behavior on:

- **B2B cross-tenant writes** ([`b2bChat.ts`](../../src/server/routes/b2bChat.ts), 1,799 LOC) — the asker's HTTP request mutates the peer's SQLite via `runWithTenantContextAsync`. There is no request id deduplication; a network retry inserts a second copy of the inbound message into the peer's `chat_messages`.
- **Slack interactions** (`POST /api/slack/interactions`) — Slack retries unack'd events for ~30 minutes. Without idempotency the bot will eventually post a reply twice or open duplicate review threads.
- **OAuth callbacks** — single-fire today, but a refresh-token rotation path will need it.
- **`POST /api/inbox/sync`**, `POST /api/calendar/sync`, etc. — duplicate kicks can interleave; today this is bounded by the supervisor but not enforced.

**Why this is a Tier 1 risk:** Idempotency is a **protocol-level guarantee** — once a client is in the wild without including a request id, retrofitting is a coordinated client+server change. With a Tauri desktop app already shipped, every client we deploy without idempotency lengthens the upgrade window.

**Why now:** `notifications.idempotency_key UNIQUE` ([`tenantSqlite.ts:88`](../../src/server/lib/tenant/tenantSqlite.ts)) is exactly the right shape — it already exists for one table. Generalize to a request-level convention: `X-Idempotency-Key` header accepted on all `POST/PATCH/DELETE` routes that mutate user data, persisted in a small `request_log` table per tenant (or in the global DB for cross-tenant paths) with a 24-hour TTL.

---

### R3. No real deletion / GDPR pipeline

**What:** "Delete the directory" is the documented model ([per-tenant-storage-defense.md § Encapsulation](./per-tenant-storage-defense.md#4-encapsulation-and-lifecycle-ergonomics)). It is a great property of the storage architecture. But true deletion has to include data we do not own:

- **LLM provider retention** — Anthropic and OpenAI retain prompt + completion content for 30 days by default. Some of that content is the user's mail body verbatim ([SECURITY.md § P5](../SECURITY.md#p5--user-data-sent-to-llm-apis-without-redaction)).
- **New Relic logs** — every `brainLogger` call ingests with tenant context.
- **Backup ZIPs** (`var/wiki-backups/`, future S3 snapshots) — by design retained beyond live data.
- **Tenant registry on disk** — `tenant-registry.json` keeps the `google:<sub>` ↔ tenant id mapping until `removeIdentityMappingsForTenantUserId` is explicitly called ([`tenantRegistry.ts:119`](../../src/server/lib/tenant/tenantRegistry.ts)).
- **DigitalOcean volume snapshots** — operator-side; not covered by app code at all.
- **Plaintext Google refresh tokens** in `ripmail/` ([SECURITY.md crown jewels](../SECURITY.md#crown-jewels)) — survive on any backup that has been written.

**Why this is a Tier 1 risk:** The first paying EU user starts a 30-day clock on a real DSAR. Saying "we delete your directory" is not a defense; auditors look at every store. **This is also a moat:** [STRATEGY.md § Moats](../STRATEGY.md#moats) names trust as the differentiator vs platform incumbents. A weak deletion story undermines that pitch *more* than a strong one would.

**Why now:** The set of stores is small enough to write down on one page. While there are <100 users, a deletion request can be handled by a script that grep's every store and emits a tenant-scoped removal plan. Once we are at scale, you need automation, and automation needs a complete map of stores — which is exactly what we have today and will lose as the codebase grows.

**Suggested direction:** A single `docs/data-inventory.md` that lists every store, retention class, and deletion path. A `pnpm run tenant:delete <tenantUserId>` script that touches all of them (or refuses, listing what it cannot). Treat the script as the spec.

---

### R4. Long-lived credentials stored plaintext on the data volume

**What:** Already in [SECURITY.md § P2/P3](../SECURITY.md#p2--session-tokens-stored-plaintext-on-block-volume), but the CTO framing is slightly different:

- Google **refresh tokens** (per tenant, in `ripmail/`) — multi-year credentials issued by Google. A volume snapshot taken today and exfiltrated in 2027 is still usable in 2027.
- Slack **bot tokens** (per workspace, in `brain-global.sqlite`) — same property.
- **Vault session tokens** — 7-day TTL, less severe but on the same volume.
- **`.env` secrets** colocated with data on the host.

**Why I am repeating this:** SECURITY.md classifies these as P2/P3 (medium) for *today's* threat model. With the **trust-network moat** in mind ([STRATEGY.md](../STRATEGY.md)), the bar is "no plaintext long-lived credentials at rest, ever" rather than "no current attacker has the access to read them." The cost of getting this wrong is **permanent** in a way other security risks are not — once a snapshot exists, you cannot un-leak the token; rotation requires every user to re-consent to Google.

**Why now:** Two-line fix per store: derive a per-tenant key from a single host secret (libsodium `crypto_secretbox`), encrypt the token-bearing JSON before write, decrypt on read. Tomorrow's snapshots become safe. Today's snapshots are already a forever-liability we accept knowingly rather than discover later.

---

## Tier 2 — Cheap to fix at our size, structural to fix at scale

### R5. Tenant identity is the filesystem directory name

**What:** `tenantUserId` is both the application identity *and* the directory name under `$BRAIN_DATA_ROOT/<usr_…>/`. This conflation is convenient but means:

- **Rename is impossible** — every reference (sessions, grants, links, registry, S3 keys, log lines, agent diagnostic filenames) embeds the same string.
- **Soft delete is impossible** — `rm -rf` is the only deletion primitive; there is no "marked deleted, recoverable for 30 days" window.
- **Storage relocation is impossible** — a tenant cannot be moved to a different volume or cell without a full content rewrite.
- **Account merge is impossible** — a user who signs up twice (work + personal Google) cannot consolidate without losing one history.
- **Pseudonymization for analytics is impossible** — every observability surface either has the real id or has nothing.

**Why this matters as a CTO question:** Every one of these is a feature request that will eventually arrive ("I changed jobs," "I want to delete my work workspace and keep the personal one"). Each one becomes a small migration project rather than a routine product change.

**Suggested direction:** Introduce `tenantId` (opaque ULID) as the *internal* primary key, with `tenantDirName` as a derived alias maintained in `handle-meta.json`. Every new SQL row keys off `tenantId`. Existing rows are migrated as part of R1's migration framework. The directory rename is the last step (and can be deferred indefinitely — it just becomes a property, not the identity).

---

### R6. No API versioning and no typed client/server contract

**What:** All routes are `/api/<area>` with no version segment. Request and response shapes are ad-hoc TS types on the server, manually mirrored in Svelte components. There are ~35 route files; a typical handler returns `c.json({ ... })` with whatever fields the caller of the day wanted.

**Why this is Tier 2:** Two compounding problems:

1. **Shipped clients diverge from server.** A Tauri desktop app pinned to last month's API contract may not auto-update for weeks. Today the only deployed client is web (always-fresh) and a desktop build that is operator-controlled. Once desktop installs reach end users, every breaking change is a per-user upgrade event.
2. **Refactor breakage is silent.** Renaming a server field does not produce a TS error in the Svelte code; it produces a runtime `undefined` somewhere. Today we have ~5 contributors so this is contained; at 15 contributors it becomes a leading cause of regression.

**Why now:** Two cheap interventions, neither requires a big rewrite:

- **Prefix all routes `/api/v1/`** today. Costs one search-and-replace and a Hono route remap; ships forward compatibility forever.
- **Adopt a shared schema layer** — zod for request/response definitions, generated client types. Hono has first-class zod support (`@hono/zod-validator`). Migrate route-by-route; new routes start typed.

This is the kind of decision where doing it at 35 routes costs an afternoon. Doing it at 150 routes costs a week and an embarrassing number of bugs.

---

### R7. Module-level singletons for "background work" are tenant-leaky in multi-tenant mode

**What:** [`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts) keeps `loopRunning` and `isPaused` as **module-level** variables. The doc itself flags this as a correctness hazard ([background-sync-and-supervisor-scaling.md § Global `isPaused` vs per-tenant disk](./background-sync-and-supervisor-scaling.md#global-ispaused-vs-per-tenant-disk)): one tenant's request can flip the in-memory pause state seen by another tenant's lap.

The agent session `Map` in [`assistantAgent.ts`](../../src/server/agent/assistantAgent.ts) and the JSON-file vault session store + tenant registry ([agent-session-store.md](./agent-session-store.md)) have analogous shapes: a single-process assumption baked into a global.

**Why this matters now:** The Phase-1 "uber container" deployment is in production at staging. Each new tenant we add increases the probability that a real user observes "I paused my wiki sync; why did someone else's lap also stop?" or "my chat session has weird state because two tabs hit different process-global caches."

**Suggested direction:** Replace each module-level global with a `Map<tenantId, State>` keyed off the tenant context. This is a 30-line change per global and an unblock for any Phase-2 work that assumes per-tenant isolation in-memory.

---

### R8. Agent context has no untrusted-content boundary (prompt injection)

**What:** Email bodies, calendar event descriptions, web fetch results, B2B query strings from peers, wiki content authored by others (via shares) — all flow into LLM context as raw text. There is no marker like `<untrusted-content>...</untrusted-content>` or content-class metadata in the prompt envelope. There is no per-source policy ("don't follow instructions inside email bodies").

**Why this matters now:** The product surface that makes this exploitable already exists: any third party who can email you can attempt to instruct your agent. Worse, B2B and the soon-to-ship Slack ambassador let *trusted* peers send content that becomes context; a single compromised peer is now a vector against the owner-side agent. This is **not** "we should redact PII before LLM calls" (that is a different P5 question); it is **"the model has no way to distinguish a user instruction from a peer's text."**

The wiki — your stated long-term moat — is the highest-value target. An adversary who can write into a shared wiki page (via grants) and then ask the owner agent "summarize my recent changes" has an instruction-following surface inside trusted content.

**Why now:** Today every prompt site is in a small set of files (`src/server/prompts/`, `src/server/agent/`). Adding a `wrapUntrusted(text, sourceKind, sourceTenant)` helper now, and routing every tool result through it, is a contained refactor. After we add 30 more tools and 10 more agent personas, it is a much bigger one.

**Suggested direction:** Two minimum bars:

1. **Envelope markers.** Every tool result that contains content the agent did not author is wrapped in a structural tag the system prompt teaches the model to treat as data, not instructions.
2. **Per-source classifier.** A small table of `{ sourceKind: 'email' | 'wiki-self' | 'wiki-peer' | 'b2b-peer' | 'web', defaultInstructionTrust: 'none' | 'low' | 'high' }`. Tools tag their output; the wrapper enforces the policy in the prompt.

This is also a moat narrative ([STRATEGY.md § Trust](../STRATEGY.md#from-imitators-below)) — being able to publish a one-page **"how Braintunnel handles prompt injection"** is a differentiator vs incumbents who say nothing.

---

### R9. No per-tenant cost ceilings on agent / LLM calls

**What:** `/api/chat` runs LLM inference with no budget cap, no rate limit, no per-tenant quota ([SECURITY.md § P9](../SECURITY.md#p9--no-rate-limiting-on-auth-or-llm-endpoints)). Any signed-in user can pin the server in a loop and run up arbitrary provider costs. A buggy client (e.g. a Svelte component in a tight reactive loop calling `chat`) can do the same accidentally.

**Why this is a CTO-level item, not just a security one:** Cost is an existential variable for an early-stage company. A single bad afternoon — a user with a long-context chat session, a tool loop that doesn't terminate, a peer who hits your B2B endpoint — can burn a week of runway. With a small user base this is easy to notice and refund; with 500 users it is a daily-noise problem hidden inside aggregate bills.

**Suggested direction:** A per-tenant **rolling token budget** (e.g. N tokens/hour, M tokens/day) enforced before every LLM call. Hard cap → 429 + a brief explanation. The infrastructure (Pi options, model resolution) already gives us token-count visibility. Tracking can live in `var/brain-tenant.sqlite` as a rolling-window table.

The companion is **per-call cost annotation** — already partially in place via NR custom events ([archived OPP-072](../opportunities/archive/OPP-072-llm-usage-token-metering.md)). The missing piece is the *enforcement loop*, not the *measurement*.

---

## Tier 3 — Trust and operability investments that compound

### R10. No structured audit / event log for sensitive operations

**What:** We log requests (`hono/logger`) and we have agent diagnostics for LLM turns ([`agentDiagnostics.ts`](../../src/server/lib/observability/agentDiagnostics.ts)). What we do **not** have is an append-only event log answering "what happened to this tenant's data, when, by whom?" — i.e. things like:

- "Session S signed in via Google, granted email scope, at T."
- "Agent sent email E on behalf of tenant T at time U; user approved or auto-approved per policy P."
- "B2B grant G created/revoked at time V by user W."
- "LLM provider P received N bytes of email body Y at time Z."

**Why this matters:** Three reasons, in order of how soon they bite.

1. **User-facing trust UI.** A "what has the agent done in my name?" view is one of the highest-value UI surfaces for a personalization product. It is also the *only* way to debug "the agent sent the wrong email" complaints.
2. **Security forensics.** Today, if someone reports "I think my account was used to query a peer," there is no record to consult.
3. **Compliance and B2B sales.** Enterprise buyers (your stated graduation target — [STRATEGY.md](../STRATEGY.md#where-to-focus)) require audit logs. Retrofitting them later requires instrumenting hundreds of write sites; doing it now instruments ten.

**Suggested direction:** `tenant_events` table in the tenant DB, append-only, with a small event-kind enum and JSON payload. Helper `recordEvent(kind, payload)` that every sensitive write site calls. Treat the table as durable product data, not a log.

---

### R11. Cross-tenant writes via in-process context switch couple trust to process boundary

**What:** B2B chat writes the peer's `brain-tenant.sqlite` directly via `runWithTenantContextAsync` ([chat-history-sqlite.md § B2B](./chat-history-sqlite.md#b2b-cross-tenant-writes-and-cell-scaling)). The doc correctly flags this as a Phase-2 scaling problem; I want to elevate it to a Tier-3 architectural one.

**Why elevate it:** The current shape says "any process that has both directories mounted can write either one." That conflates **trust** (do I have a grant from the peer?) with **co-location** (does my process happen to share storage with theirs?). As soon as we run two cells — for any reason, not just scale — peer-pair routing breaks. And the "fix later" is not just plumbing: it is a peer-to-peer protocol design (auth, idempotency, error semantics, SSE bridging) that we have not started.

**Why now:** The B2B surface area is small today (`b2bChat.ts` is 1,799 LOC but with a clean route shape). Defining a "peer write" as an **internal HTTP RPC** today — even when both tenants are in the same process — is a small refactor that lets the routing become an infrastructure decision later. Postponing it adds every new B2B feature to the "must be redesigned for cells" pile.

This is the same shape as R6 (API versioning): cheap when the surface is small; expensive when it isn't.

---

### R12. No formal SLO, error budget, or kill switches

**What:** We have New Relic, structured logs, and good test coverage. We do **not** have:

- A written **SLO** (e.g. "99% of `/api/chat` first-token latency under 5s; 99.9% of `/api/wiki` reads return successfully").
- An **error budget** to spend or protect.
- **Kill switches** for individual features (e.g. "disable Slack integration globally without a deploy" or "disable LLM-based dir-icon lookup if OpenAI is degraded").
- **Feature flags** for canary rollouts (you ship one binary; everyone gets it).

**Why this is Tier 3, not Tier 1:** It does not lose data. But it shapes operator habits, and operator habits are durable. A team that operates without SLOs for 18 months and then tries to introduce them will discover that every existing dashboard, alert, and on-call expectation is calibrated to "feel" rather than "agreement."

**Suggested direction:** Two pages — `docs/SLO.md` and a minimal `feature-flags.json` file at the global level (or a `flags` table in the global DB) that the server consults on a 30s tick. SLOs are mostly a thinking exercise; flags are a `if (flagEnabled('slack-integration', tenantId)) { ... }` helper plus an admin UI later.

---

## Lower-priority callouts (still worth getting right while small)

- **Plaintext JSON for sessions and tenant registry under concurrent writes.** Already flagged in [agent-session-store.md](./agent-session-store.md); the fix is to move into the global SQLite. The cost is one schema migration (so blocked on R1).
- **`brain-global.sqlite` mixes per-tenant rows (Slack user settings, grants) with truly global rows (rate-limit windows).** All currently keyed by `tenant_user_id`, but there is no `WHERE tenant_user_id = ?` enforcement at the access layer — a bug in one query can read another tenant's row. A thin repository wrapper that takes a `tenantId` and refuses queries without it (mirroring the AsyncLocalStorage discipline on the FS side) would close this gap.
- **Wiki-as-git** as the backing store for desktop ([PRODUCTIZATION.md § 2](../PRODUCTIZATION.md)). Two divergent storage stories will fork code paths if not decided. Choose one — *files + ZIP history* (per [backup-restore.md](./backup-restore.md)) is the simpler answer; the IDEA-wiki-sharing internal-git revisit should not block normal users.
- **Oversized Svelte parents** (`Assistant.svelte` 2,162 lines, `AgentChat.svelte` 1,718, `Inbox.svelte` 895). Already noted in [web-app-source-reorganization-plan.md](./web-app-source-reorganization-plan.md). UI bugs in these files take disproportionate time to triage.
- **`/api/dev/*` guarded only by `NODE_ENV`** ([SECURITY.md § P7](../SECURITY.md#p7--dev-routes-guarded-only-by-node_env)). A misconfigured docker-compose is one missing env var away from public hard-reset. Belt-and-suspenders: also require a vault session.
- **Shell injection via `JSON.stringify(q)` in `grep` exec** ([SECURITY.md § P1](../SECURITY.md#p1--shell-injection-via-grep-with-user-supplied-query-string)). Replace `exec` with `spawn(argv)`; one afternoon's work.
- **No internationalization beyond English yet but i18n machinery exists** ([i18n.md](./i18n.md)). Good — when you add the second language, the keys are already there. Make sure new strings continue to land in `locales/en/*.json` rather than as raw literals in components.

---

## What's already right (don't change)

Calling these out so the above doesn't read as a teardown:

- **Directory-per-tenant + AsyncLocalStorage** — defended thoroughly and well; do not litigate this again ([per-tenant-storage-defense.md](./per-tenant-storage-defense.md)).
- **Single-codebase desktop + cloud** — strategically right ([deployment-models.md](./deployment-models.md)). The cost of two codebases is a permanent tax; the cost of two storage *seams* in one codebase is small.
- **SQLite over Postgres for per-tenant data** — correct given the workload ([chat-history-sqlite.md § Postgres deferred](./chat-history-sqlite.md#postgres-deferred-no-near-term-plans)). The only thing to add is real migrations (R1) and per-tenant audit (R10); Postgres is not the answer.
- **`pi-agent-core` + `pi-ai` + tool-design philosophy** — [agent-tool-design-philosophy.md](./agent-tool-design-philosophy.md) is the kind of doc that prevents an entire class of agent-loop bugs. Keep iterating in that style.
- **pnpm supply-chain hygiene** (`check:malware-lockfile` in CI) — unusually mature for early stage; do not let it bitrot.
- **A real SECURITY.md** — P1–P13 is high-quality work. The new CTO does not rewrite this; it reads it carefully and addresses what it lists.

---

## Suggested sequencing

If I had a quarter's worth of focused effort to spend on the items above, the order I would spend it in:

1. **R1 (migrations) and R4 (encrypt long-lived credentials at rest) together.** Same week; both are write-path interventions that get harder with every store added.
2. **R3 (deletion pipeline doc + script).** A single Friday's work at our current size; an unbounded project at 1k users.
3. **R6 (`/api/v1/` prefix + zod adoption on new routes).** One afternoon for the prefix; zod adoption is gradual.
4. **R8 (prompt-injection envelope) and R9 (per-tenant LLM budgets).** Both belong to the agent layer; sequence them together and ship as one "agent safety" release.
5. **R2 (idempotency) and R10 (audit events).** Same table shape (`request_log` and `tenant_events`); align the schema once.
6. **R5 (internal `tenantId` vs directory name).** Larger; blocks on R1's framework. Schedule after R1 lands.
7. **R7 (per-tenant background-state isolation).** Small but unblocks Phase-2.
8. **R11 (B2B as internal HTTP).** Larger refactor; do it before adding the next B2B feature, not after.
9. **R12 (SLO + flags).** Continuous; introduce when one painful incident makes the case for you.

None of these are speculative work for "what if we have a million users." Every one of them is cheaper this quarter than next, and meaningfully cheaper this quarter than after the first 1000-user week.

---

## Out of scope

Things I deliberately did not put on the list:

- **Postgres / centralized DB.** [per-tenant-storage-defense.md](./per-tenant-storage-defense.md) and [chat-history-sqlite.md](./chat-history-sqlite.md) are right. Re-litigating this is unproductive.
- **A separate background worker process.** Useful eventually; today's single-process model is fine if R7 is fixed.
- **Mobile app.** Product question, not architecture.
- **Replacing Hono / Svelte / Tauri / Pi.** Frame-of-reference choices that have not paid for any rework yet.

---

## Related

- [SECURITY.md](../SECURITY.md) — operational + security risks (P1–P13). This doc complements rather than replaces.
- [per-tenant-storage-defense.md](./per-tenant-storage-defense.md) — the architectural bet this risk review accepts as a premise.
- [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md), [cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md) — Phase-2 cell design that several of these items unblock.
- [chat-history-sqlite.md](./chat-history-sqlite.md), [agent-session-store.md](./agent-session-store.md) — known persistence and session limits.
- [STRATEGY.md](../STRATEGY.md) — the trust moat that R3, R4, R8, R10 directly serve.
- [AGENTS.md](../../AGENTS.md) — "no backwards compatibility in early dev" rule that R1 asks us to start sun-setting *for the next release*, not retroactively.

---

*Author note: this doc is opinion. Disagreement is the point. Move items to "decided not to act on" with a brief rationale rather than letting them sit.*
