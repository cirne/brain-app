# OPP-102: Tenant app SQLite — chat history, notifications, and shared schema lifecycle

**Status:** Open — **single per-tenant SQLite** for Brain-owned app state (not ripmail index, not global ACL DB).

**See also:** [chat-history-sqlite.md](../architecture/chat-history-sqlite.md) (target schema for sessions — absorbed into this OPP) · [per-tenant-storage-defense.md](../architecture/per-tenant-storage-defense.md) · [data-and-sync.md](../architecture/data-and-sync.md) · [brain-to-brain-access-policy.md § notification](../architecture/brain-to-brain-access-policy.md#notification-inbox-and-human-in-the-loop-prerequisite-for-secure-brain-to-brain) · **[IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md)** · **[IDEA: Brain-query delegation](../ideas/IDEA-brain-query-delegation.md)** (consumer of notification rows for async outbound approval — follow-on wiring) · [brain-layout.json](../../shared/brain-layout.json) / [`brainLayout.ts`](../../src/server/lib/brainLayout.ts)

## Problem

1. **Chat** is stored as **per-session JSON files** under `chats/`. Listing and routing **scale poorly**; there is **no** durable query or FTS without scanning everything — see [chat-history-sqlite.md](../architecture/chat-history-sqlite.md).
2. **Notifications / brief items** (anticipatory assistant, future brain-query approvals) have **no first-class persistence**; mail `notify` / inbox disposition lives in **ripmail’s** SQLite and APIs, separate from a unified “what the user should see next” model.
3. Other small **JSON blobs** under the tenant tree may belong in a **queryable store** over time; we need **one** place to hang app-scoped tables without multiplying databases.

## Goal

Introduce a **Brain app SQLite** file **per tenant home** (hosted: `$BRAIN_DATA_ROOT/<usr_…>/`; desktop: under `BRAIN_HOME`), **parallel to** ripmail’s DB under `ripmail/` — same **tenant-boundary** story, **different** file and domain.

1. **Schema versioning** (integer), stored in-db or in a small meta table — mirror the **spirit** of ripmail’s `SCHEMA_VERSION`: on startup, if the code’s expected version **does not match** persisted state, **delete the DB file and recreate empty schema** (no migration scripts).
2. **Early-dev rule:** schema changes are **breaking** until we **explicitly** decide otherwise; document in PR/commits. Aligns with [AGENTS.md](../../AGENTS.md) (clean break, no migrations for pre-release local data).
3. **Initial tables (minimum):**
   - **Chat:** sessions + messages (+ optional FTS per [chat-history-sqlite.md](../architecture/chat-history-sqlite.md)); **behavior parity** with current JSON-backed `chatStorage` / routes.
   - **Notifications:** at least one table for **app-originated** notification / brief items (stable id, source kind, payload JSON, user state, timestamps, idempotency key as needed) so [**IDEA: Anticipatory assistant brief**](../ideas/IDEA-anticipatory-assistant-brief.md) has a real store — **basic** create/list/patch covered by tests; minimal UI or internal enqueue path acceptable for “basic notifications working.”
4. **Move chat** from JSON files into this DB in the **same** change set (or tightly sequenced PRs) so we do **not** end up with both `chats.db` and a second app DB without cause. **Prefer one file** (name TBD in implementation — e.g. `var/brain-app.sqlite` or `chats.db` under tenant root; update [`brain-layout.json`](../../shared/brain-layout.json) + helpers when the path is fixed).

## Non-goals (this OPP)

- **Ripmail schema** or moving mail index into this DB.
- **`brainGlobalDb`** / `.global` — grants, tenant registry, cross-tenant ACL stay **global** as today.
- **Storing Google OAuth tokens or session secrets** in this SQLite — **out of scope** unless a follow-on explicitly decides; default assumption is **keep current auth storage** unchanged.
- **Full anticipatory brief UX** (empty chat ranking, LLM prioritization, push) — only **persistence + minimal API / wiring** required here.
- **Production-grade migrations** — explicitly deferred until product stabilizes.

## Open questions (track here)

### Mail `notify` vs notification rows — one source of truth?

Inbox / `ripmail` already encodes **rule disposition** (`notify` / `inform` / `ignore`) and **per-message** decision state in **ripmail’s SQLite**. Options for the **Brain app** notification table:

| Approach | Summary |
|--------|--------|
| **A — Ripmail authoritative** | Brain brief reads inbox APIs / ripmail; **no** duplicate mail state in app SQLite. App table holds **non-mail** items only (system, future brain-query, etc.). |
| **B — Denormalized snapshots** | When surfacing mail in the brief, **insert or upsert** rows in app SQLite (teaser, `message_id`, link) for fast unified queries; ripmail remains canonical for mail **content** and rule recomputation. |
| **C — Controller merge only** | No mail rows in app DB; a **service layer** merges ripmail candidates + app rows at read time. |

**Decision:** TBD before or during implementation; document chosen approach in this file and in [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md) if product copy depends on it.

### What else moves from JSON in this OPP?

**Candidates** (optional stretch if low risk): nav recents, fragments of onboarding adjunct state — see [chat-history-sqlite.md § follow-ons](../architecture/chat-history-sqlite.md). **Not required** for closing OPP-102 if chat + notifications minimum ships with parity.

## Acceptance criteria

1. **Chat:** existing flows (**list sessions**, load session, append messages, delete session, title/preview behavior, URL prefix routing assumptions) **do not regress** — covered by **tests** touching `chatStorage` (or successor) and relevant routes.
2. **Schema lifecycle:** bumping `SCHEMA_VERSION` in code **recreates** DB without manual steps; documented for operators/devs.
3. **Notifications:** **at least one** code path **persists and reads** notification rows (API or internal helper) with **tests**; documented **purpose** and **mail dedup** stance (per open question above).
4. **Layout:** tenant path documented in `brain-layout` (or sibling doc) so desktop + hosted use the same relative path.

## Related

- [chat-history-sqlite.md](../architecture/chat-history-sqlite.md) — target session schema; status line points here.
- **[IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md)** (full brief UX, brain-query approvals, mail SSOT open question).
- **[IDEA: Brain-query delegation](../ideas/IDEA-brain-query-delegation.md)** — **Per-grant approval** and inbound/outbound surfacing depend on notification persistence; enqueue/approval wiring **after** OPP-102 lands.
- **[IDEA: Onboarding insight gallery](../ideas/IDEA-onboarding-insight-gallery.md)** — distinct cadence from standing brief; may share signals or read paths later.
- [OPP-071](OPP-071-llm-telemetry-traces-and-usage-cli.md) / [OPP-072](OPP-072-llm-usage-token-metering.md) may later **read** chat from SQLite instead of `chats/` JSON — note when chat storage lands.
