# OPP-113 — Tunnel connections: unified activity surface

**Status:** Open (concept)  
**Area:** Navigation / IA / UI — B2B + email  
**Complexity:** Large (touches nav model, primary surface, new data views, replaces Inbox)  
**Supersedes / absorbs:** current `inbox` zone (email listing), `review` zone (B2B inbound), and Tunnels rail section in ChatHistory — into one cohesive surface.  
**Related:** [OPP-112](OPP-112-review-queue-ux-overhaul.md) (review UX; Issues 7–8 folded in), [OPP-110](archive/OPP-110-chat-native-brain-to-brain.md) (chat-native B2B), [OPP-111](archive/OPP-111-tunnel-fast-follows.md) (review queue + auto-send)

---

## Problem

Braintunnel has three disconnected surfaces for communication activity:

1. **Inbox** (`/inbox`) — incoming email only, rules-driven, 24h window. No sent mail. No B2B traffic.
2. **Review** (`/review`) — B2B inbound drafts awaiting approval. Feels like a separate app.
3. **Tunnels rail** (sidebar section in ChatHistory) — outbound B2B sessions listed as chat rows. No unified view of what you've asked *and* what others have asked you.

A user who wants to answer "what's going on with Alice?" has to check three places. Sent email is invisible entirely. The nav model treats email and tunnel activity as unrelated concepts, but to the user they are both **connections** — someone you exchange information with through your brain.

---

## Concept: Connections

Replace Inbox, Review, and the Tunnels rail with a single primary surface: **Connections**.

A **connection** is any person (or entity) your brain has exchanged information with — email, tunnel, or both. The nav shows each connection as a row. The icon on each row communicates the nature and state of the relationship:

| Icon | Meaning | Example |
|------|---------|---------|
| `<=>` | Bidirectional — you've both sent and received | A colleague you email back and forth with |
| `==>` | Outbound only — you've sent, they haven't replied (or no inbound yet) | A cold tunnel you opened; an email you sent to a new contact |
| `<==` | Inbound only — they've reached you, you haven't sent | A new tunnel query; a newsletter sender; someone who emailed you |
| `==>` (request) | Pending outbound — awaiting their review/approval | A tunnel query waiting for the other brain to approve |

These are not literal arrow strings in the UI — they are small, tasteful directional icons (probably custom or adapted from Lucide). The point is to communicate **direction** and **state** at a glance without labels.

---

## What the surface looks like

### Left rail (replaces Inbox nav + Tunnels rail + Review nav)

The rail is a **flat list of connections**, sorted by most recent activity. Each row shows:

- **Direction icon** (see table above)
- **Name** (contact name, handle, or email)
- **Last activity snippet** — subject line or message preview, truncated
- **Timestamp** — relative time of last activity
- **Badge** (optional) — unread count or "pending" indicator

The list is **not** split into sections by channel. Alice appears once whether you've emailed her, tunneled to her, or both. The connection row is the unified entry point.

**Filtering:** a compact segmented control or filter bar above the list provides lenses:

- **All** — every connection with recent activity
- **Needs attention** — inbound items you haven't acted on (replaces the Review pending concept)
- **Sent** — your recent outbound activity (the missing feature that prompted this)

Filters are additive lenses on the same data, not separate pages.

### Detail pane (right side, replaces Inbox thread reader + ReviewDetail)

Clicking a connection opens a **timeline of activity with that person**, newest first. The timeline interleaves:

- **Inbound email threads** (with the existing thread reader)
- **Outbound email threads** (sent mail — new capability)
- **Tunnel exchanges** (inbound queries + your approved replies, outbound queries + their replies)

Each timeline entry is a card showing direction, subject/question, timestamp, and expandable body. The user can drill into any entry to read the full thread (reusing the existing thread/email overlay).

For entries that need action (pending B2B drafts, unanswered emails), the card shows inline action affordances — approve/edit/dismiss for tunnel drafts, reply/archive for email.

### Empty state / cold start

A new user with no connections sees a clean prompt: "Your connections will appear here as you send and receive email and open Braintunnels." The "Open a Braintunnel" action (currently in the Tunnels rail) moves to a prominent position in the Connections header.

---

## How this changes the nav

### Before (current)

```
Sidebar
├── Chats (section)
│   ├── + New chat
│   └── [chat rows...]
├── Tunnels (section)
│   ├── Inbox (N) → /review
│   ├── + Open a Braintunnel
│   └── [tunnel rows...]
└── Wiki (section)
    └── [wiki page rows...]

Dock / top-level zones:
  /c (chat) | /inbox (email) | /wiki | /review (B2B) | /hub (settings)
```

### After (proposed)

```
Sidebar
├── Chats (section)
│   ├── + New chat
│   └── [chat rows...]
├── Wiki (section)
│   └── [wiki page rows...]

Primary surface zones:
  /c (chat) | /connections (unified) | /wiki | /hub (settings)
```

Key changes:

1. **`/inbox` and `/review` merge** into **`/connections`** (new `RouteZone`).
2. **Tunnels rail section disappears** from ChatHistory — tunnel connections appear in the Connections surface.
3. **"Open a Braintunnel"** button moves to the Connections surface header (alongside filter controls).
4. The sidebar keeps Chats and Wiki sections. The Connections zone is accessed via the primary nav (dock icon, top bar, or keyboard shortcut).

---

## The hard design problem

Making this simple and elegant is genuinely difficult. The risk is building a mini-email-client or a CRM contact list — neither of which is what Braintunnel should be.

### Principles to keep it clean

1. **People, not messages.** The primary object is a *person*, not a thread. The list shows connections, not an inbox of individual emails. This is the fundamental difference from a traditional mailbox.

2. **Recency, not completeness.** The surface is a *recent activity* view, not a full archive. The time window (e.g. 7 days of email, all pending B2B) keeps the list short and actionable. Older history is accessible through search or drill-down, not by scrolling forever.

3. **Direction communicates state.** The arrow icons do heavy lifting. A glance at the list tells you: "Alice — bidirectional, last active 2h ago. Bob — inbound only, needs attention. Carol — outbound pending." No need for separate Inbox/Sent/Review sections.

4. **Progressive disclosure.** The list is minimal. The detail pane shows more. The full thread overlay shows everything. Three levels, each clean.

5. **No channel chrome.** Don't show "Email" and "Tunnel" tabs or labels on individual entries. The user doesn't care about the transport — they care about the person and the content. Channel metadata (email vs tunnel) appears subtly in the timeline entries if needed, not as top-level UI.

### Known risks

- **Naming:** "Connections" could evoke LinkedIn. Alternatives: "Activity", "People", "Network", just an icon with no label. Needs iteration.
- **Performance:** Merging email contacts + B2B tunnels into one sorted list requires a join query or merged API. Email contact volume could be large; capping to recent activity window helps.
- **Migration path:** Current Inbox and Review are separate zone-backed surfaces with tests, router entries, i18n, and mobile layouts. The transition is not a rename — it is a new component that unifies two existing ones.

---

## Implementation sketch (not a plan — just enough to prove feasibility)

### Data

- **Email connections:** derive from ripmail `messages` table — `SELECT DISTINCT from_address, to_addresses` with time window, grouped by canonical contact identity (reuse `who` / `contactRank`). Include `is_from_me` equivalent (folder-based or header-based) to classify direction.
- **B2B connections:** derive from `brain_query_grants` + `chat_sessions` (existing `GET /api/chat/b2b/tunnels` and `/review`).
- **Merged API:** new `GET /api/connections` endpoint that returns a unified list sorted by `last_activity_at`, each entry tagged with direction state and channel(s). Paginated, filterable by lens (all / needs-attention / sent).

### Router

- New `RouteZone`: `'connections'` at `/connections`.
- Deprecate `'inbox'` and `'review'` zones (redirect to `/connections` with appropriate filter).

### Components

- `Connections.svelte` — primary surface (list + detail split).
- `ConnectionRow.svelte` — single row with direction icon, name, snippet, time.
- `ConnectionDetail.svelte` — timeline of activity entries for one connection.
- Reuse existing `Inbox.svelte` thread reader and `ReviewDetail.svelte` action affordances inside the detail pane, refactored as composable sub-views.

### Direction icons

Custom or Lucide-composed. Candidates:

- `ArrowLeftRight` (bidirectional)
- `ArrowRight` (outbound)
- `ArrowLeft` (inbound)
- `ArrowRight` + clock/hourglass (pending outbound)

Or: thin custom glyphs that look more like flow connectors than navigation arrows — closer to the tunnel metaphor.

---

## Relationship to existing opportunities

| OPP | Disposition |
|-----|------------|
| [OPP-112](OPP-112-review-queue-ux-overhaul.md) Issues 1–6 | Already shipped; inform the detail-pane action UX in ConnectionDetail |
| OPP-112 Issue 7 (sender info + policy panel) | Folds into ConnectionDetail — the connection *is* the sender context |
| OPP-112 Issue 8 (cold-query initiation) | Entry point moves from Tunnels rail to Connections header |
| [OPP-109](OPP-109-layered-spam-and-bulk-mail-classification.md) (inbox triage) | Still relevant — triage logic feeds the "needs attention" filter |

---

## Open questions

1. **Should Chats stay separate, or fold into Connections too?** A "My Brain" chat is a connection with yourself. If Connections absorbs everything, the sidebar simplifies to just Wiki. But that might be too ambitious and could confuse the chat-first UX. Recommend: keep Chats separate for now; Connections is the *other people* surface.

2. **What about organizational/automated senders?** Newsletters, GitHub notifications, etc. are inbound-only connections with no real person behind them. Should they appear in Connections or remain filtered by inbox rules into oblivion? Probably: rules suppress them from the default "All" view, but a "show filtered" toggle reveals them.

3. **Mobile layout.** The current Inbox and Review have mobile-specific layouts. Connections needs a single-column mode where the list fills the screen and tapping a row pushes to the detail view. This is tractable but must be designed.

4. **Agent context.** Today the agent gets `{ type: 'inbox' }` when the user is on the Inbox surface. The new context should be `{ type: 'connections' }` or `{ type: 'connections', connectionId: '...' }` so the agent knows which person the user is looking at and can assist contextually.

---

## Why this matters

The inbox-as-list-of-recent-emails model is a solved problem — every email client does it. Braintunnel's value is *not* being a better email client. It is being the place where you understand and manage your **relationships and information flow** across channels. Connections as a first-class nav concept moves the product closer to that identity and further from "chatbot with an email viewer bolted on."

Sent mail visibility — the original trigger for this exploration — falls out naturally: every connection shows both directions of activity. No need for a separate "Sent" tab or mailbox concept.
