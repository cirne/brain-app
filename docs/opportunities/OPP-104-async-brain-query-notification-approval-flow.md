# OPP-104: Async brain-query (B2B) — notifications, human-approved drafts, shared agent for auto-send

**Status:** Proposed — **Phase 1** (notification + review-before-send); **Phase 2** (optional auto-send) gated on Phase 1 user testing.

**Strategy note (2026-05):** Product direction favors **mail as the canonical async plane** and **ruthless removal** of **`runBrainQuery` / `ask_brain`** in favor of email + classifications + existing draft/send flows. See **[OPP-106 — Email-first cross-brain collaboration](OPP-106-email-first-cross-brain-collaboration.md)** (supersedes this doc’s engineering approach).

**See also:** [brain-query-delegation.md](../architecture/brain-query-delegation.md) · [IDEA: Brain-query delegation](../ideas/IDEA-brain-query-delegation.md) · [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md) · [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md) · **[OPP-102](archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** (tenant `notifications` — shipped) · [OPP-056](OPP-056-email-draft-overlay-markdown-editor.md) (draft/review UX patterns) · [OPP-100](OPP-100-brain-query-policy-records-and-grant-fk.md) (policy SSOT on grants)

## Problem

Today **`ask_brain` / `runBrainQuery`** runs the **answering** tenant’s agent **synchronously**: research pass → privacy filter → the filtered string returns **immediately** to the **asker’s** chat. That is fast for demos but a poor fit for **async B2B**:

- The **answerer** has no **durable, lightweight surface** (“something needs your attention”) when they are not in chat.
- There is **no human-in-the-loop** step analogous to **email**: open item → **draft already prepared** → **edit** → **approve and send** (or decline).
- **Deferred work** is awkward: the system either burns LLM cost up front or forces the asker to wait on a long blocking call.

Product intent: treat cross-brain requests like **high-signal inbound work**—**notify first**, **generate the draft when the owner shows up**, then **release**—before considering **fully automatic** replies.

## Goal

### Phase 1 — Notification-first, draft on engagement

1. When a granted peer sends a brain-query, the **owner** gets a **`notifications` row** (and any brief/empty-chat surfacing built on that substrate — see [IDEA-anticipatory-assistant-brief](../ideas/IDEA-anticipatory-assistant-brief.md)) carrying at least: **asker identity**, **question text**, **correlation id / log pointer**, and **deep link** into the review flow.
2. **No blocking answer generation** is required before the asker’s client gets an ACK: the asker may see “request queued” / async status (exact UX TBD).
3. When the owner **opens the notification**, the product runs the **same answering pipeline** as today (research + privacy filter scoped by grant **capabilities and policy**), but outputs into a **review artifact**—**editable** copy the owner can adjust before **sending** the final text to the asker.
4. UX should **reuse patterns** comparable to **mail drafts** where practical (overlay editor, approve/discard) — see [OPP-056](OPP-056-email-draft-overlay-markdown-editor.md)—so the mental model stays **“draft for me, I edit, I release.”**

### Phase 2 — Automatic delivery (after Phase 1 is trusted)

After **Phase 1** has been exercised and product/org testing says auto-send is acceptable **for some connections**:

1. Allow a **per-grant (or per-policy) delivery mode**: e.g. **review required** vs **auto-send after filter** (names TBD).
2. **Critical engineering constraint:** **auto-send must call the same agent entrypoint and policy enforcement** as the human-reviewed path—**one implementation** with a **mode flag** (or equivalent), not a second “fast path” model stack. Automatic responses must be whatever the owner would have gotten **at approve time** with the same grant, tools, and privacy filter instructions (subject only to timing/data drift if the owner delays in Phase 1—that is acceptable and honest).

## Non-goals (baseline)

- **Cross-instance / federation routing** — unless/until covered elsewhere; this OPP assumes the **same hosted deployment** behavior as Phase 0 unless paired with future routing work.
- Replacing **audit logging** — `brain_query_log` (or successor) should still record asker/owner views, draft vs delivered text as needed for trust.

## Acceptance — Phase 1

- **Server:** enqueue **inbound** brain-query as a **typed notification** (schema + API or internal hook); persist **enough** to reconstruct the question and tie to **one** log row or idempotency key.
- **Client:** notification **tap** opens **review**; **lazy** draft generation runs on that open (or explicit “Generate draft” if we need lazy cost control—product choice).
- **Deliver:** **Approve** posts the final answer to the asker-visible outcome (shape matches today’s successful `runBrainQuery` result); **Decline** records a clear owner-visible state without leaking unintended content.
- **Tests:** `src/**/*.test.ts` for notification creation, idempotency, and the “open → draft → approve” state machine at the repository/route level; client tests if UI is non-trivial.

## Acceptance — Phase 2

- **Grant/policy** records a **delivery mode**; enforcement is **server-side**.
- **Auto-send** path invokes the **shared** answering+draft function (single policy resolution, same tool allowlist, same filter pass) before outbound delivery.
- **Tests:** mode matrix (review vs auto); regression that auto path cannot bypass policy text or tool caps that review path uses.

## Related implementation notes

- **Persistence:** tenant SQLite **`notifications`** from **[OPP-102](archive/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** is the natural store; extend `kind` / payload JSON as needed.
- **Policy:** when **[OPP-100](OPP-100-brain-query-policy-records-and-grant-fk.md)** lands, **delivery mode** should attach to **policy or grant** consistently with other per-connection knobs.
