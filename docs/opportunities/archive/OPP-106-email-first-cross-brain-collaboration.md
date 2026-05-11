# Archived: OPP-106 — Email-first cross-brain collaboration (synchronous pipeline removed)

**Status: Archived — shipped (2026-05-10).** **Live summary:** [brain-query-delegation.md](../../architecture/brain-query-delegation.md) · [brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md). **Stub:** [../OPP-106-email-first-cross-brain-collaboration.md](../OPP-106-email-first-cross-brain-collaboration.md)

---

# OPP-106: Email-first cross-brain collaboration — **ruthlessly** remove synchronous brain-query agent + previews; keep grants/policies

**Status:** Proposed — **large simplification.** Default cross-brain Q&A rides **ordinary email** plus **Ripmail classify / notifications** (same substrate as **`mail_notify`**), not a bespoke cross-tenant agent RPC.

**Supersedes the *engineering approach* of:** [OPP-104](./OPP-104-async-brain-query-notification-approval-flow.md) (async notification-first brain-query built on **`runBrainQuery`** + approve path). That OPP duplicated “inbox + draft + send” semantics; this OPP **deletes that parallel stack**.

**Keeps aligned with:** [OPP-100](../OPP-100-brain-query-policy-records-and-grant-fk.md) (policy SSOT → grants) · [brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md) (three-layer policy vision; **`brain_query_grants`** remain consent + policy prose or **`policy_id`**) · [OPP-056](../OPP-056-email-draft-overlay-markdown-editor.md) (draft/review UX) · **`notifications`** substrate ([archived OPP-102](./OPP-102-tenant-app-sqlite-chat-and-notifications.md)).

**Ideas:** [IDEA-brain-query-delegation](../../ideas/IDEA-brain-query-delegation.md) (update after implementation — transport becomes email; grants still boundary) · [IDEA-anticipatory-assistant-brief](../../ideas/IDEA-anticipatory-assistant-brief.md) (still want a **short prioritized queue** — now fed by flagged mail + other sources).

---

## Problem

1. **`ask_brain` / `runBrainQuery` / `POST /api/brain-query`** are a **synchronous LLM→LLM** path scoped by grants. Users **do not trust automatic answers** crossing personal boundaries.

2. The natural fix—**OPP-104-style** notify → lazy draft → human approve/send—recreates **email** badly: persistence, threading, federation, spam handling, identity, archive, drafts, multi-account **`from`**, attachments — all already solved by Ripmail + Gmail.

3. **Product entropy:** Maintaining **two planes** (“brain-query transport” vs mail) balloons code, routes, previews, SSE research agents, filter agents, **`brain_query_log`**, **`brain_query_inbound`** notifications tied to **`runBrainQuery`**, Hub “Brain access” surfaces built around previews/audit tied to **that pipeline**, onboarding copy about **`ask_brain`**, and tests for all of it.

4. Strategic clarity: **`brain_query_grants` + privacy policy text** are the **right durable object** — **which collaborators may invoke my assistant toward them** — but enforcing that through a **duplicate agent stack** is not.

---

## Goal

Treat **cross-brain questions as email**: a stable **marker** (e.g. subject prefix **`[brain]`**, optional header **`X-Braintunnel-Query`**, correlation id in headers/body — product choice) identifies “this is a collaborator question under grant.” **Inbound classification** merges into Ripmail-derived **`notifications`** (extend **`mail_notify`** payload / rule path or add a deterministic tag **without** minting **`brain_query_*`** notification kinds for the obsolete pipeline).

**Answerer UX:** tapping the item kicks the **regular** assistant (full mail/wiki/calendar tooling) with **grant policy injected** into the drafting prompt → user reviews via existing **`draft_email` / overlay** flows → **`send_draft`** (human always approves in the default posture).

**Asker UX:** assistant composes **`draft_email`** / reply to collaborator with marker + structured question — no **`ask_brain`** tool required.

Optional **future** (**explicitly gated**): **synchronous cross-tenant tool call** (fast path demo, low latency). If brought back: **narrow** scoped route + **`live_query_enabled`** (or equivalent) **per grant** — **small** codebase, **not** a resurrected **`runBrainQuery`** monolith. Optional future **auto-reply-after-filter-only** mode for wired relationships may reuse **only** research + privacy-filter + send — **still not** mandatory for the MVP of this OPP.

---

## Non‑negotiable: ruthless deletion and simplification

This work is **not** “add email path and leave the old one.” Implementing partial overlap **for long** wastes trust and reviewer time.

**When this OPP is executed:**

1. **Delete** (or revert to stubs only if interim PR requires — **merged state must empty**):

   - **Server:** **`src/server/lib/brainQuery/runBrainQuery.ts`** (research agent + privacy-filter agent orchestration path), **`rejectQuestionTool.ts`**, **`brainQueryEarlyRejection.ts`**, **`brainQueryTool.ts`** (the **`ask_brain`** tool), **`brainQueryLogRepo.ts`** and **`brain_query_log`** usage, **`POST /api/brain-query`** runner and **`/preview/research`** + **`/preview/filter`** SSE/JSON endpoints.
   - **Routes:** prune **`registerApiRoutes`** / feature flags (**`BRAIN_B2B_ENABLED`** or successor) until only **grant CRUD** (and policy resolution helpers) remain **or** grant CRUD lands on a clearer **`/api/…/sharing`** name — acceptable follow-on only if churn is unavoidable; primary requirement is **`runBrainQuery` + previews + logs + ask tool are gone**.
   - **`createNotificationForTenant`** paths that exist **only** to mirror completed **`runBrainQuery`** (**`brain_query_inbound`** with **`deliveryMode: auto_sent`**) — **remove** alongside pipeline.
   - **Agent tooling registration:** unregister **`ask_brain`** globally; **`createAgentTools` / registry** must not advertise it.
   - **LLM helper copy:** **`notificationKickoffPrompt`** / **`notificationKickoffAppContext`** branches for **`brain_query_inbound`** that describe **`runBrainQuery`** / **`ask_brain`** — replace or delete; **`brain_query_grant_received`** may stay if still accurate with **grant-only semantics** (**`src/shared/notifications/presentation.ts`** parity).
   - **Tests:** all **`runBrainQuery`**, **`ask_brain`**, **`brainQuery` routes**, **`AnswerPreviewPage`**, preview SSE/filter integration tests tied to **`/api/brain-query/preview/*`** — removed or rewritten for **grant-only** APIs + mail classification fixtures.

2. **Remove obsolete client product surface tied to synchronous brain-query**

   - **Hub / Settings routes** for **`/settings/brain-access/.../preview`**, **`AnswerPreviewPage.svelte`**, and **any SSE “simulate cross-brain answer” UX**.
   - The **whole** **`src/client/components/brain-access/`** subtree **unless** repurposed immediately in the same PR as a **slim grants + policy editor** — **preferred:** delete and add a **minimal** replacement (single list + revoke + policy textarea/templates) rather than dragging half‑dead pages.
   - **`BrainHubPage.svelte`** · **`hub.json`** **`hubBrainAccessSummary`** · **`BrainSettingsPage.svelte`** **Brain to Brain** row — update or delete so nothing points at **`ask_brain`** or **`/api/brain-query`** preview semantics.
   - **`registryIcons`** entry for **`ask_brain`**.
   - **`router.ts`** and **`Assistant.svelte`** settings shell entries for **`brain-access-preview`** and obsolete drill-ins tied to previews.
   - **Locale:** strip **`src/client/lib/i18n/locales/en/access.json`** (and **`settings.json`** / **`hub.json`**) strings that encode **brain-query-agent** / **`ask_brain`** / synchronous-audit wording; replace with grant + **email collaborator** wording or delete keys until rebuilt.

3. **Keep (data + intent):**

   - **`brain_query_grants`** (global DB), **`privacy_policy`** string per grant until **[OPP-100]** moves policy to **`policy_id`** SSOT — **grants remain the ACL + policy capsule**.
   - **Grant CRUD APIs** wired to **`createBrainQueryGrant`** / revoke / PATCH policy — may be relocated/renamed; **behavior** remains: opt‑in collaborator list + prose policy the assistant consumes when drafting **mail** replies (and when any future live tool exists).

4. **`tenantSoftReset` / globals:** remove **`deleteBrainQueryLogForTenant`** and **`brain_query_log`** table DDL when table dropped; grants cleanup stays until product says otherwise.

---

## Security & trust notes

- **Grant is enforcement, marker is UX:** unsolicited mail with **`[brain]`** is **not** special unless **`From`** resolves to an authorized **`brain_query_grants`** asker identity (**`resolveUserIdByPrimaryEmail`** or equivalent rules — follow current grant resolution semantics).
- **Human-in-the-loop default** aligns with Ripmail **`send_draft`** contract (“confirmation after draft visible”).
- **Optional Phase 2 auto-send** stays **explicitly gated** — not part of MVP delete path.

---

## Acceptance criteria

1. **`grep`/CI sanity:** **`ask_brain`**, **`runBrainQuery(`**, **`/api/brain-query/preview`** **absent from shipping code paths** (except migration notes / archived docs).

2. **Product:** collaborator Q&A **works** via **email send + classify + notify + draft-from-chat** smoke path (checklist in PR).

3. **Documentation:** **`brain-query-delegation.md`**, **`IDEA-brain-query-delegation.md`**, **`OPP-104`**, **`brain-to-brain-access-policy.md`** cross-link this OPP; architecture describes **mail as canonical async plane** after merge.

4. **`BRAIN_B2B_ENABLED` (or replacement):** still gates collaborator features if present — **behavior** shifts to grants + classification; no hidden synchronous brain RPC.

---

## Related implementation pointers (today — deletion targets)

| Area | Locations (representative; grep for fallout) |
|------|-----------------------------------------------|
| Core pipeline | `src/server/lib/brainQuery/runBrainQuery.ts`, `rejectQuestionTool.ts`, `brainQueryEarlyRejection.ts` |
| Grants (keep repo; drop logs) | `src/server/lib/brainQuery/brainQueryGrantsRepo.ts` |
| Logs (delete with OPP) | `src/server/lib/brainQuery/brainQueryLogRepo.ts` |
| API | `src/server/routes/brainQuery.ts`, `brainQuery.test.ts` |
| Tool | `src/server/agent/tools/brainQueryTool.ts`, `brainQueryTool.test.ts` |
| Agent registration | `src/server/agent/tools.ts` (and feature flags) |
| Notifications | `createNotificationForTenant` from `runBrainQuery`; `presentation.ts`; `notificationKickoffAppContext.ts` |
| Client | `src/client/components/brain-access/*`; Hub + Settings wiring; `BrainHubPage.svelte`; `BrainSettingsPage.svelte` |
| Locale | `src/client/lib/i18n/locales/en/access.json`, `settings.json`, `hub.json` (brain-collaboration strings) |

---

## Open decisions (product/engineering before merge)

Exact **marker grammar** (`[brain]` vs header vs MIME part); **classification** (**`notify`** vs new Ripmail rule action); whether **minimal grant UI** replaces **`/settings/brain-access`** URL or redirects to **Sharing** subsection; correlation id embedding for **`brain_query_grant_received`** flows.
