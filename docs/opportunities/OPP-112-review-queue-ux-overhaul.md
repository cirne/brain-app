# OPP-112 — Review queue UX overhaul

**Status:** Partially implemented (Issues 1–6 done; Issues 7–8 remain)  
**Area:** UI / B2B review workflow  
**Complexity:** Medium–Large (mostly client-side; Issues 7–8 require server + schema work)

---

## Problem

The B2B inbound review flow (tunnel replies awaiting your approval) has several compounding UX problems that make the surface feel half-built and increase the effort to act on incoming questions. Each issue is documented below.

---

## Issue 1 — "Pending" is everywhere and means nothing

The word **Pending** appears at least three times simultaneously on screen:

- **Left nav section heading** — `chat.review.nav.label` = `"Pending"`
- **Left nav button label** — `chat.history.pendingRow` = `"Pending"` (or `"Pending (N)"`)
- **Row state badge** on each list item — `chat.review.row.state.pending` = `"Draft ready"` (this one is fine; it describes a state)

The left-nav section and button are redundant copies of the same label, and "Pending" is a weak, vague word for the concept. The actual mental model is: *someone asked your brain a question, your brain drafted a reply, and it's waiting for you to send it.*

**Proposed rename:** call this surface **"Outbox"** or **"Review"** — something that names the action, not the state. The nav section and button should use the same word, so collapsing the heading entirely (or making the button *the* heading) removes the duplication. The `chat.review.nav.label` i18n key should become a single instance with a name like `"Outbox"`.

---

## Issue 2 — No auto-select on open

When the user clicks the nav link, `ReviewQueue` loads with `selectedId = null` (unless a `initialSessionId` was URL-provided). The right pane shows a "Pick a conversation" empty state. The user must click again.

**Fix:** after `load()` completes in `ReviewQueue`, if `selectedId` is still `null` and there are rows, auto-select the first pending row (or the first row if no pending exist). Also update the URL via `onNavigateSession` so deep-linking still works.

---

## Issue 3 — "Open full thread" is the only escape valve; no dismiss/ignore

The action bar only offers **Send**, **Decline**, and **Open full thread**. There is no way to dismiss an item without sending or explicitly declining (which sends a "declined" message to the asker). A third category is needed: **ignore / archive** — remove the item from the pending list without sending anything.

**Fix:** add a third action — **Dismiss** (or **Archive**) — that marks the session as ignored/archived on the server side without sending a response to the asker. This requires a new API endpoint (`POST /api/chat/b2b/dismiss`) and a new `approval_state` value (e.g. `'dismissed'`) in `chatTypes.ts`. The "Open full thread" link should move out of the primary action bar into a lower-priority affordance (e.g. a small text link or kebab menu).

---

## Issue 4 — Input UX for re-drafting is clunky

Currently: a "Notes to your agent (regenerate)" textarea + a separate "Regenerate draft" button. This is a secondary form nested inside the main form, and it requires two UI elements for a single conceptual action ("tell the agent to redo this").

**Fix:** replace the `notesToAgent` textarea + Regenerate button with the **universal chat input** component (the same `<ChatInput>` used in the main chat). The input sits at the bottom of the detail pane. Submitting it sends the message as `notes` to `/api/chat/b2b/regenerate` and the draft updates in place — no full thread needed. The placeholder should read something like `"Adjust the reply… (e.g. "make it shorter")"`. This makes the interaction feel like Canvas-style inline editing rather than a separate sub-form.

---

## Issue 5 — "Your assistant drafted" and "What they'll receive" are confusing duplicates

The detail pane currently shows **three** boxes in sequence:

1. `From @peer` — the incoming question
2. `Your assistant drafted` — editable textarea (for pending)
3. `What they'll receive` — read-only preview (mirrors the textarea)

For pending items, boxes 2 and 3 are nearly identical, creating cognitive dissonance ("why are there two?"). The intent was to show the "will receive" box as the policy-applied output, but currently it is just `draftText`, so they are literally the same content.

**Fix:** collapse to a single primary focus area. **Remove "Your assistant drafted"**. The one visible box is **"What they'll receive"** (or rename to just the peer's name / "Reply"), and it is the editable textarea for pending items. This eliminates the duplication and makes the primary action obvious: the user sees the draft, can edit it directly, and hits Send.

If policy transforms are ever added (e.g. stripping personal data before sending), the transformed version can still be shown in this single pane, since the textarea *becomes* the final reply.

---

## Issue 6 — The incoming question looks like content, not metadata

The `From @peer` box uses the same `boxClass` styling as the draft content, so the question and the reply look visually equivalent. The asker's question is metadata/context; the reply is the primary working content.

**Fix:** style the inbound question as a subdued, visually lighter "context chip" — smaller text, muted background, no heavy border — so it reads as "here's the context" rather than "here's another editable field." Consider placing it at the top as a compact header-style block above the main reply area, similar to how email clients show the original message in a reply compose view.

---

---

## Issue 7 — Sender info and inline policy panel in the Inbox detail view

When reviewing an inbound item, the user has no context about the sender and no way to change how their brain handles future queries from that sender without going to a buried settings page.

**What's needed:** a secondary header strip inside `ReviewDetail` — rendered above the incoming question — that shows:

- Sender handle (`@peer`) and display name
- Current response policy for this sender: one of **Auto-send**, **Review before sending**, **Ignore** (rendered as a segmented control or inline select)
- A "regenerate with new policy" action when the policy is changed while there are pending drafts

When the user changes the policy inline:
1. The grant/tunnel record is updated immediately via a PATCH to the server.
2. Any currently-pending drafts from this sender are regenerated with the new policy applied (e.g. switching from "Review" → "Auto-send" triggers approve + send for all queued items; "Ignore" dismisses them silently).
3. The Inbox list refreshes.

**Why this matters:** the policy is the most important lever in the entire review workflow. Surfacing it inline where decisions are made — not in a settings panel — makes the system feel like it has coherent intent rather than disconnected parts.

**Server changes needed:**
- `PATCH /api/chat/b2b/grants/:grantId` to update `auto_send` / policy field
- A `policy` field exposed on `B2BReviewRowApi` so the client doesn't need a second fetch
- Bulk-approve endpoint or loop: when switching to auto-send, enqueue approval of all pending rows for that grant

**Schema note:** current grants have an `auto_send` boolean. This should become a three-value policy (`'auto' | 'review' | 'ignore'`) to support the ignore case cleanly.

---

## Issue 8 — Frictionless tunnel initiation: the connection IS the first query

The current flow to connect two brains requires navigating to a settings panel, generating a grant URL, sharing it out-of-band, and having the other party accept. This is deeply buried and has near-zero discoverability.

**New mental model:** you connect to someone's brain the same way you send them a message. The tunnel bootstraps itself from the first query. No pre-coordination required.

### Sender side (initiating a query)

In the left nav Tunnels section, add a **"Query a brain"** / **"+ New"** button. Tapping it opens a minimal input: type a handle (`@username`) or pick from known contacts. The user types their question and sends. 

- If a tunnel already exists with that handle → the query goes through the existing tunnel as normal.
- If no tunnel exists → a provisional outbound session is created. The query is delivered to the target's Inbox as a **cold query** (a new `session_type` or a flag distinguishing it from grant-backed queries). The sender sees a "Waiting for response" state in their Tunnels list.

### Receiver side (handling a cold query)

The cold query lands in the receiver's Inbox like any other pending item, but:

- The sender header (Issue 7) shows the handle as an **unknown sender**.
- The default policy for unknown senders is **Review before sending** (configurable globally, e.g. in settings; could also be **Ignore** for privacy-first users).
- The agent still drafts a response using the receiver's brain and the default policy. If the default is "Review," it sits in the Inbox. If "Ignore," it's auto-dismissed.
- The receiver can change the policy inline (Issue 7), which sets it for all future queries from this sender and regenerates the current draft accordingly.
- Approving/sending the reply implicitly completes the tunnel handshake — both parties now have a live connection.

### Privacy model

- Unknown-sender queries are rate-limited server-side to prevent spam (e.g. 1 cold query per external handle per 24 h by default).
- Receivers can set a global "cold query policy" in settings (accept-and-review / ignore-all). This is separate from per-sender policy.
- No PII about the receiver is exposed to the cold sender until the receiver explicitly replies.

**Server changes needed:**
- New `session_subtype: 'cold_query'` or flag on `chat_sessions` to distinguish cold inbounds from grant-backed ones
- `POST /api/chat/b2b/cold-query` — creates a provisional outbound session and delivers the query to the target's Inbox
- Target-side: recipient lookup by handle (requires handle registry or federation endpoint)
- Rate-limiting middleware on cold-query delivery
- Global cold-query policy setting per tenant

**Relationship to existing tunnels:** existing grant-backed tunnels are unaffected. This is an additive path — cold queries are a new entry point that can graduate to a full persistent tunnel once both parties have exchanged at least one query/reply.

---

## Summary of changes

| # | What | Where | Size |
|---|------|-------|------|
| 1 | ~~Rename "Pending" → "Inbox"; collapse duplicate nav heading~~ **Done** | `chat.json`, `ChatHistory.svelte` | ✓ |
| 2 | ~~Auto-select first row after load; after Send/Dismiss reload, auto-advance to next pending row~~ **Done** | `ReviewQueue.svelte` | XS |
| 3 | ~~Add Dismiss + `dismissed` approval state; `POST /api/chat/b2b/dismiss`; open thread demoted to text link~~ **Done** | `b2bChat.ts`, `chatTypes.ts`, `chatSessionTypes.ts`, `tenantSqlite.ts` (schema v3), `ReviewDetail.svelte` | S |
| 4 | ~~Replace Notes + Regenerate with compact `TipTapMarkdownEditor` + submit; placeholder copy~~ **Done** | `ReviewDetail.svelte`, `TipTapMarkdownEditor.svelte` | S–M |
| 5 | ~~Single **Reply** editor (removed duplicate draft / “what they’ll receive”); i18n `chat.review.detail.layers.reply`~~ **Done** | `ReviewDetail.svelte`, `chat.json` | XS |
| 6 | ~~Subdued inbound question “context chip” styling~~ **Done** | `ReviewDetail.svelte` | XS |
| 7 | Sender info + inline policy panel in Inbox detail | `ReviewDetail.svelte`, `b2bChat.ts` PATCH, `B2BReviewRowApi`, grant schema | M |
| 8 | Frictionless cold-query initiation (the connection IS the first query) | `ChatHistory.svelte`, new API route, handle registry, rate limiting | L |

**Shipped (2026-05) — Issues 2–6 + data model fix**

- Inbox list uses **`GET /api/chat/b2b/review?state=pending`** only (actionable queue). Approved/declined/auto-sent rows no longer appear there; **`dismissed`** state is stored and excluded from review listing (`TENANT_SCHEMA_VERSION` bumped to **4**).
- **Each inbound query gets its own `b2b_inbound` session** — `runB2BQueryForGrant` always creates a new session per query. Alice asking Bob two questions creates two separate inbox items (FIFO). The `UNIQUE(session_type, remote_grant_id)` index now applies only to `b2b_outbound` (`idx_b2b_outbound_unique`).
- After Send or Dismiss, the inbox list reloads and **auto-advances** to the next pending item (or clears selection if none remain).
- `ReviewDetail` redesigned: subdued incoming-question chip, single “Reply” textarea, compact `TipTapMarkdownEditor` regenerate input, Dismiss button alongside Send/Decline.

Issues 7–8 require meaningful server + schema work and should be tackled as a **second pass**.

### What remains (follow-up)

- **Issue 7** — Sender strip, three-value policy (`auto` / `review` / `ignore`), `PATCH /api/chat/b2b/grants/:grantId`, expose `policy` on `B2BReviewRowApi`, bulk behavior when switching policy.
- **Issue 8** — Cold-query flow, new session subtype/flag, `POST /api/chat/b2b/cold-query`, rate limits, global cold-query policy per tenant.

---

## Out of scope

- Full streaming regenerate (the current blocking POST is acceptable for now)
- Mobile-specific layout changes beyond what the above CSS fixes naturally achieve
- Federation / cross-instance cold queries (Issue 8 initial scope is same-instance handle lookup only)
