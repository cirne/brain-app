# Anticipatory assistant brief — prioritized queue, notification infrastructure, and async approvals

**Status:** Backlog — **SQLite persistence shipped (2026-05)** — **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** (`var/brain-tenant.sqlite`: chat + **`notifications`**, mail **`notify`** mirror); **full brief UX** (unified ranked strip across domains) still backlog. **Braintunnel B2B** approve/decline ships in chat — [architecture/braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md).  
**Index:** [IDEAS.md](../IDEAS.md)  
**Relates to:** [VISION.md](../VISION.md), [STRATEGY.md](../STRATEGY.md), **[IDEA-brain-query-delegation](IDEA-brain-query-delegation.md)** (B2B grants + tunnels; **tunnel HIL** ships in chat — [braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)), [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md) (notification §; persistence **[shipped — OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)**), [chat-history-sqlite.md](../architecture/chat-history-sqlite.md), [IDEA-onboarding-insight-gallery](IDEA-onboarding-insight-gallery.md) (showcase vs standing queue), [IDEA-wiki-sharing-collaborators (archived)](archive/IDEA-wiki-sharing-collaborators.md) (collaboration events), [onboarding-state-machine.md](../architecture/onboarding-state-machine.md); empty chat surfaces such as [`ConversationEmptyState.svelte`](../../src/client/components/agent-conversation/ConversationEmptyState.svelte)

---

## Scope: two layers

This document describes **one product concept with two layers** that should share the same underlying **item model** (IDs, lifecycle, channels, dismiss/snooze, deep links):

1. **Brief queue (assistant-forward)** — the small “when you walk in, here is what matters” list—often anchored in **empty chat**, but the same items may appear in **Home**, **digest**, or **badge** affordances.
2. **Notification and inbox infrastructure** — durable handling of **cross-surface events** that need attention **asynchronously**: not only **mail** classified as `notify` / high-signal, but also **collaboration**, **system health**, **calendar**, **wiki**, and—critically—**brain-to-brain** events (see below).

Ripmail’s `notify` / `inform` / `ignore` disposition is **one input** to this system, not the whole system. The anticipatory layer **aggregates and ranks** signals so the product is not a second Gmail inbox.

---

## Problem

Users open Braintunnel to **talk to an assistant**, not to re-read their whole inbox or every wiki change. Important work often sits **across surfaces**: flagged mail, shared vault material, upcoming calendar commitments, wiki drift since last visit, **pending decisions about what may leave their workspace toward a connected peer** — but there is no single **short, trustworthy “here is what matters right now”** strip that behaves like meeting an executive assistant who has already filtered noise.

Traditional **notification badges** scatter attention (inbox badge, wiki badge, calendar alerts elsewhere) without **grounding** the user in language and context the agent can act on next.

**Brain-to-brain (today):** **Braintunnel B2B** ships **owner review / approve** and **decline** for tunnel replies (`/api/chat/b2b`, review queue, notifications) — [architecture/braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md). **Backlog:** a **single anticipatory “brief”** that ranks tunnel items alongside mail/calendar/wiki in one strip — [IDEA-brain-query-delegation](IDEA-brain-query-delegation.md) for policy/grants; this doc is where that **unified** surface remains specified.

---

## The idea

Treat the assistant as owning a **prioritized item queue** backed by a **notification + inbox** substrate:

- **Brief queue:** a **small, curated set** of items the product believes the user should hear about soon — analogous to **“when you walk in, here is what I need from you.”**
- **Inbox / notification semantics:** items have **state** (unhandled, snoozed, dismissed), **source** (mail, calendar, brain-query, share, system, …), **urgency**, and a **stable deep link** into the right surface (chat starter, Hub, approval sheet).

It is explicitly **not** “everything unread.” It emphasizes:

- **Input needed** (“they asked X; you have not replied”).
- **Decisions** (“pick A vs B”; “approve or decline”; **“review draft answer before it goes to @peer”**).
- **Time sensitivity** (“starts in five minutes”; “trial ends tonight”).
- **Cross-surface arrivals** (“someone shared a folder with you”; “new collaborator note on `trips/`”).
- **Brain-to-brain** (“**@alice** asked a question under your brain-query grant”; “draft answer **ready for your review**”; “response **sent** or **blocked** by filter”).

The assistant (or deterministic rules upstream of chat) **filters and prioritizes** so the list stays **emotionally manageable** — more like **five bullets** than a second inbox.

### Why this beats email for cross-brain requests

For **information requests** from a granted peer, the answering side’s system can produce a **draft response** (post-research, post–privacy-filter or **pre–final send**, depending on product rules). The owner’s job becomes **review, light edit, approve send** — or **deny** — **without drafting cold mail**. That is **lower friction** than mailbox ping-pong, **faster** than rewriting context the assistant already gathered, and **safer** than hoping recipients only ever use auto-send, because the **same notification surface** can enforce **“nothing crosses until you confirm”** when the connection policy says so.

### Trust ladder (analogy: coding agents)

Per connection (or per event type), the product can offer a **progressive trust** model similar to **approve once / always allow / ask every time** for tool use in coding agents:

- **Auto-send after filter** — maximum flow; relies on policy + filter quality (Phase 0 posture).
- **Notify + review before send** — draft appears in the **brief / inbox**; user **edits** optional text and **releases** (or **blocks**).
- **Stricter modes later** — e.g. always review for certain **peers**, **topics**, or until **N** successful auto-sends (product detail).

The **notification infrastructure** is what makes those modes **actionable** when the user is **not** staring at Hub logs: **push** optional; **in-app inbox** authoritative.

---

## User experience (hypothesis)

**Primary surface:** The **empty chat** state — before the user types a free-form question — shows the brief as a **vertical list of single-line summaries** (one row per item: icon + terse title + optional micro-metadata like “mail” / “calendar” / “wiki” / **“brain query”**).

- **Click / tap an item:** Starts (or resumes) the conversation with a **purpose-built first assistant message** and implied tool context for that domain — or opens an **approval** view for brain-query drafts — not a generic “how can I help?”
- **User can ignore the list** and type their own question at any time; the brief does not block chatting.
- **Per-item dismissal:** Quick actions such as **dismiss**, **archive**, **don’t surface again**, or **snooze** — modeled on EA behavior (“I’ll handle the noise; you tell me only if priorities shift”).
- **Badge / prominence:** Count or dot on Chat (or wherever new sessions start) can reflect **unhandled brief items**, but the **authoritative UX** is the **empty compose area** (plus a dedicated **Inbox / Activity** entry if the list grows).

**Optional adjuncts** (later or parallel): pinned row on Home, morning-style digest entry point — still backed by the same **brief / notification item** model.

**Brain-query approval row (illustrative copy):** “**@alice** asked about the Q2 roadmap — **draft ready** · Review before send.” Tapping opens the **draft**, **question**, **policy** summary, and actions **Send** / **Edit & send** / **Decline** (wording subject to trust copy review).

---

## Candidate notification / brief sources

These are **illustrative**; implementation would enforce caps, merging, and freshness rules.

| Source | Example one-liner |
|--------|-------------------|
| **Mail (notify rule / flags)** | “Payment failed on Acme invoice — reply may be urgent.” |
| **Mail obligations** | “Thread with Jordan: unanswered question since Tuesday.” |
| **Collaboration / sharing** | “Alex shared `projects/q2/` read-write.” |
| **Wiki / vault** | “Three pages changed since your last session in `travel/`.” |
| **Calendar** | “Sync with Dana in **5 minutes** (Zoom linked in invite).” |
| **Brain-query (inbound)** | “**@alice** asked a question you allow under brain-query — **review draft** (or: **answered automatically** per your setting).” |
| **Brain-query (outbound / asker side)** | Optional: “Reply from **@donna** arrived” / “**@donna** declined or blocked the request” (delivery UX TBD). |
| **Onboarding / setup** | “Finish Gmail scopes to enable send.” |
| **System / reliability** | “Ripmail sync paused — reconnect account.” |

**Anticipatory** items are those that imply **immediate agent utility**: summarize, draft, reschedule, wiki diff, collaborator reply, **cross-brain approve** — not raw firehose events.

---

## Prerequisites for secure, usable brain-to-brain

[IDEA-brain-query-delegation](IDEA-brain-query-delegation.md) + [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md) describe **policy, grants, and LLM filtering**. Those are necessary but **not sufficient** for the trust posture many users will want:

- **Asynchronous** follow-up when the owner is not in the app when a query lands.
- **Human-in-the-loop** release of outbound content without treating **audit logs** as the only review surface.
- **Bidirectional visibility** (asker and answerer) surfaced through **consistent notification semantics**, not ad hoc email.

**This idea is the required product capability** that ties those strands together: a **notification + inbox + brief** layer that brain-query (and future bilateral flows) plug into. See [brain-to-brain-access-policy.md — notification / human-in-the-loop §](../architecture/brain-to-brain-access-policy.md#notification-inbox-and-human-in-the-loop-prerequisite-for-secure-brain-to-brain). **`notifications` + chat in `var/brain-tenant.sqlite`** **shipped** under **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** — see [§ Next steps](#next-steps-after-persistence).

---

## Principles

1. **Short list wins:** Hard or soft caps (e.g. 3–7 visible items); overflow folds into “More” or defers by score.
2. **Explainable urgency:** Each line should map to **why** it surfaced (rule, TTL, explicit user flag, **grant policy mode**).
3. **No shame inventory:** Avoid turning the brief into a guilt list; prioritize **constructive next steps**.
4. **Same model for dismissal:** Dismissing removes from brief **without** pretending the underlying mail or brain-query event vanished — aligns with source truth but **conversation-first** UX.
5. **Privacy-conservative defaults:** Sensitive categories may **never appear** as one-line previews on shared screenshots; teaser copy may need aggregation (consistent with conservative onboarding/gallery norms). Brain-query rows may show **handles** and **topic labels** rather than raw draft text in list view.
6. **Brain-query items are first-class:** Same lifecycle APIs as other sources (idempotency, dedupe, read state).

---

## Relationship to onboarding insight gallery

[IDEA-onboarding-insight-gallery](IDEA-onboarding-insight-gallery.md) is **discovery** (“tap a curated tile once to see something impressive”).

This idea is **continuity** (“every time you start fresh, here is the standing prioritized pull”) and **operational infrastructure** (notifications, approvals, async delivery).

They can share infrastructure (signals from mail/wiki/calendar) but differ in **cadence**, **lifetime**, and **copy**.

---

## Open questions

1. **Data model:** Are brief items ephemeral (session), durable per user (`brief_items` / `notification_items` store), or derived on the fly from existing indexes plus a small overrides table? Brain-query **pending approval** likely needs **durable rows** (queue until send/deny).
2. **Agent vs deterministic:** Which rows are pure rules (deadline TTL) vs LLM-ranked from a larger candidate pool?
3. **Multi-device / hosted:** Dedup and read/unread semantics across tabs and desktop; **brain-query** delivery when owner offline.
4. **Collaboration specifics:** Notification when another user edits a shared path — granularity (file vs subtree) and permission awareness.
5. **Calendar depth:** Only “soon” reminders vs proactive “prep pack” requiring extra tokens.
6. **Mail semantics:** Formalize “notify” (inbox rule, Gmail flag, Brain tag) vs inferred obligation detection — merging rules when both fire. **Implemented stance:** ripmail authoritative; **`notify`** mirrored into app **`notifications`** — **[archived OPP-102](../opportunities/archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** (decision table).
7. **Brain-query semantics:** When is a **draft** visible to the owner vs only **final**? How do **filter_blocked** and **early_rejected** appear in the inbox for asker vs answerer?
8. **Evaluation:** Fixtures for brief ranking and copy safety (beyond retrieval evals); **golden cases** for approval UX (no draft leak in list previews).

---

## Next steps after persistence

**Shipped:** **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** — **`var/brain-tenant.sqlite`** with **`TENANT_SCHEMA_VERSION`** (early-dev wipe on bump): **chat** tables + **`notifications`**; mail **`notify`** mirrored from ripmail (**`source_kind = mail_notify`**).

When the product model and MVP sources are pinned, additional OPPs may cover:

- **Schema + lifecycle:** Notification/brief item CRUD, snooze, idempotency keys per source event; **brain-query pending outbound** state machine (draft → approved → delivered / denied).
- **Client:** Empty chat rendering, dismissal affordances, deep-link starter prompts; **approval sheet** for brain-query drafts.
- **Signals:** Thin adapters from ripmail flags, collaborator events, wiki change digest, calendar window, **Braintunnel B2B** tunnel / notification events ([braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)).
- **Brain-query server:** Per-grant **delivery mode** (auto vs require approval) and hooks to **enqueue** items instead of immediate `POST` response when approval is required.

Until those ship, this file anchors **executive briefing + notification infrastructure + async brain-query approvals** as one conceptual package—the **central metaphor** for prioritized, cross-domain assistant alerts and **trustworthy** cross-brain collaboration.
