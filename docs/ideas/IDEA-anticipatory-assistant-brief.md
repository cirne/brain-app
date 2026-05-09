# Anticipatory assistant brief — prioritized “tell me first” queue in empty chat

**Status:** Backlog — no OPP yet; product + chat UX  
**Index:** [IDEAS.md](../IDEAS.md)  
**Relates to:** [VISION.md](../VISION.md), [STRATEGY.md](../STRATEGY.md), [IDEA-onboarding-insight-gallery](IDEA-onboarding-insight-gallery.md) (showcase vs standing queue), [IDEA-wiki-sharing-collaborators (archived)](archive/IDEA-wiki-sharing-collaborators.md) (collaboration events), [onboarding-state-machine.md](../architecture/onboarding-state-machine.md); empty chat surfaces such as [`ConversationEmptyState.svelte`](../../src/client/components/agent-conversation/ConversationEmptyState.svelte)

---

## Problem

Users open Braintunnel to **talk to an assistant**, not to re-read their whole inbox or every wiki change. Important work often sits **across surfaces**: flagged mail, shared vault material, upcoming calendar commitments, wiki drift since last visit — but there is no single **short, trustworthy “here is what matters right now”** strip that behaves like meeting an executive assistant who has already filtered noise.

Traditional **notification badges** scatter attention (inbox badge, wiki badge, calendar alerts elsewhere) without **grounding** the user in language and context the agent can act on next.

---

## The idea

Treat the assistant as owning a **brief queue**: a **small, curated set** of items the product believes the user should hear about soon — analogous to **“when you walk in, here is what I need from you.”**

It is explicitly **not** “everything unread.” It emphasizes:

- **Input needed** (“they asked X; you have not replied”).
- **Decisions** (“pick A vs B”; “approve or decline”).
- **Time sensitivity** (“starts in five minutes”; “trial ends tonight”).
- **Cross-surface arrivals** (“someone shared a folder with you”; “new collaborator note on `trips/`”).

The assistant (or deterministic rules upstream of chat) **filters and prioritizes** so the list stays **emotionally manageable** — more like **five bullets** than a second inbox.

---

## User experience (hypothesis)

**Primary surface:** The **empty chat** state — before the user types a free-form question — shows the brief as a **vertical list of single-line summaries** (one row per item: icon + terse title + optional micro-metadata like “mail” / “calendar” / “wiki”).

- **Click / tap an item:** Starts (or resumes) the conversation with a **purpose-built first assistant message** and implied tool context for that domain — not a generic “how can I help?”
- **User can ignore the list** and type their own question at any time; the brief does not block chatting.
- **Per-item dismissal:** Quick actions such as **dismiss**, **archive**, **don’t surface again**, or **snooze** — modeled on EA behavior (“I’ll handle the noise; you tell me only if priorities shift”).
- **Badge / prominence:** Count or dot on Chat (or wherever new sessions start) can reflect **unhandled brief items**, but the **authoritative UX** is the **empty compose area** itself — badges become discoverability, not the whole story.

**Optional adjuncts** (later or parallel): pinned row on Home, morning-style digest entry point — still backed by the same **brief item** model.

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
| **Onboarding / setup** | “Finish Gmail scopes to enable send.” |
| **System / reliability** | “Ripmail sync paused — reconnect account.” |

**Anticipatory** items are those that imply **immediate agent utility**: summarize, draft, reschedule, wiki diff, collaborator reply — not raw firehose events.

---

## Principles

1. **Short list wins:** Hard or soft caps (e.g. 3–7 visible items); overflow folds into “More” or defers by score.
2. **Explainable urgency:** Each line should map to **why** it surfaced (rule, TTL, explicit user flag).
3. **No shame inventory:** Avoid turning the brief into a guilt list; prioritize **constructive next steps**.
4. **Same model for dismissal:** Dismissing removes from brief **without** pretending the underlying mail vanished — aligns with inbox truth but **conversation-first** UX.
5. **Privacy-conservative defaults:** Sensitive categories may **never appear** as one-line previews on shared screenshots; teaser copy may need aggregation (consistent with conservative onboarding/gallery norms).

---

## Relationship to onboarding insight gallery

[IDEA-onboarding-insight-gallery](IDEA-onboarding-insight-gallery.md) is **discovery** (“tap a curated tile once to see something impressive”).

This idea is **continuity** (“every time you start fresh, here is the standing prioritized pull”).

They can share infrastructure (signals from mail/wiki/calendar) but differ in **cadence**, **lifetime**, and **copy**.

---

## Open questions

1. **Data model:** Are brief items ephemeral (session), durable per user (`brief_items` store), or derived on the fly from existing indexes plus a small overrides table?
2. **Agent vs deterministic:** Which rows are pure rules (deadline TTL) vs LLM-ranked from a larger candidate pool?
3. **Multi-device / hosted:** Dedup and read/unread semantics across tabs and desktop.
4. **Collaboration specifics:** Notification when another user edits a shared path — granularity (file vs subtree) and permission awareness.
5. **Calendar depth:** Only “soon” reminders vs proactive “prep pack” requiring extra tokens.
6. **Mail semantics:** Formalize “notify” (inbox rule, Gmail flag, Brain tag) vs inferred obligation detection — merging rules when both fire.
7. **Evaluation:** Fixtures for brief ranking and copy safety (beyond retrieval evals).

---

## Next step toward shipping

When the model and MVP sources are pinned, spin **one or more OPPs**, for example:

- **Schema + lifecycle:** Brief item CRUD, snooze, idempotency keys per source event.
- **Client:** Empty chat rendering, dismissal affordances, deep-link starter prompts.
- **Signals:** Thin adapters from ripmail flags, collaborator events, wiki change digest, calendar window.

Until then this file anchors **“executive briefing in the empty composer”** as the central metaphor for prioritized, cross-domain assistant alerts.
