# Archived: OPP-110 — Chat-native brain-to-brain (B2B via chat, not email)

**Status: Archived (2026-05-12).** **Stub:** [../OPP-110-chat-native-brain-to-brain.md](../OPP-110-chat-native-brain-to-brain.md) · **Follow-on:** [OPP-111-tunnel-fast-follows.md](OPP-111-tunnel-fast-follows.md) (**stub:** [../OPP-111-tunnel-fast-follows.md](../OPP-111-tunnel-fast-follows.md); **shipped 2026-05-12**).

---

# OPP-110: Chat-native brain-to-brain (B2B via chat, not email)

**Status:** Archived (2026-05-12) — narrative retained for reference.

**Fast follow:** **[OPP-111](OPP-111-tunnel-fast-follows.md)** — tunnel fast follows (**shipped 2026-05-12**): wiki capture on the asker tenant **and** inbound send control + non-misleading inbound chat UX.

**Parent idea:** [IDEA-brain-query-delegation.md](../ideas/IDEA-brain-query-delegation.md) · **Policy model:** [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md) · **Grants CRUD (shipped):** [brain-query-delegation.md](../architecture/brain-query-delegation.md)

---

## The vision

Right now, if you want to ask someone else's brain a question, the transport is email: you send a `[braintunnel]`-marked message, their agent eventually answers in a reply, and it surfaces as a mail notification. That's familiar but wrong. The experience should feel like **chat — instant, conversational, threaded** — and it should live *inside the same chat list* that already exists for talking to your own brain.

Instead of "compose an email to ask Donna's brain what the project status is," you open a conversation with **Donna's Brain** the same way you'd open a new chat with your own brain. You type. You get a synthesized answer. You follow up. You never see her wiki files, email threads, or tool results — just the answer her brain prepared for you, filtered by whatever policy she's set. It feels like talking to a well-informed assistant who happens to represent another person.

This is a significant UX shift:

- **Email goes away as the collaboration transport.** The `[braintunnel]` subject marker, `brain_query_mail` notification kind, and the flow of "send mail → wait for reply → receive mail" are replaced by a chat session.
- **`ask_brain` tool is removed.** You don't ask *your* brain to ask *their* brain via a tool call. You directly open a chat with their brain.
- **Grants and ACL stay exactly as-is.** You can only open a B2B chat if an active grant exists (they granted you access). Nothing about the trust model changes.
- **The UX becomes a consistent chat list** with a clear mental model: who am I talking to?

---

## Terminology: Braintunnel vs “tunnel” in the feature

The product is already **Braintunnel** (one word, capital **T** in the name). The original concept was a **tunnel between brains** — your instance, a secured opening, someone else’s brain on the other side. Chat-native B2B is a natural place to **reuse that metaphor**, but it should be done with intent, not by plastering “tunnel” everywhere.

### Does “tunnel” roll off the tongue?

**Where it works**

- **Outbound grant chats** really are a *channel through* to another person’s assistant: you never touch their raw corpus; only filtered answers come back. Saying you’re opening a **tunnel to Donna** (or a **tunnel** named after the person) matches the mental model and aligns with the brand story without repeating the word “Braintunnel” in every sentence.
- A short nav label like **Tunnels** sits next to **My Brain** without sounding like broken grammar (unlike a bare **Other Brains** sometimes does in localization).
- Tooltip or one-line empty state: *“A tunnel is a chat through to someone who gave you access — you only see answers, not their mail or files.”* ties the UI to the privacy story.

**Where it gets awkward**

- **The app name is Braintunnel.** Copy like “open a Braintunnel to Donna” or “your Braintunnels” reads like a marketing stutter or confuses **the application** with **a single connection**. Prefer **“a tunnel to…”** or **“Tunnel to Donna”** for the relationship, and reserve **Braintunnel** for the product (“in Braintunnel, go to Chat → Tunnels”).
- **Inbound** is not symmetric vocabulary: the other person isn’t “tunneling to you” in user-friendly terms — they opened a tunnel *from their side*; you experience **requests to your brain**. Forcing “reverse tunnel” or “incoming tunnels” is engineering-flavored. Keep **Inbound** (or **Requests**) for clarity.
- **Plural “brain tunnels”** in every row (“Donna’s brain tunnel”) is heavy. Better: section **Tunnels**, rows **Donna** or **Donna’s assistant** with a small **tunnel** badge or subtitle if needed.

### Recommendation for this feature (not a global rename)

| Surface | Suggested copy | Notes |
|--------|----------------|--------|
| Sidebar section (outbound list) | **Tunnels** (primary) | Short, brand-adjacent. Subtitle if needed: “People who granted you access.” Plain-language alt: **Other brains** if “Tunnels” tests as too abstract in usability. |
| New-chat brain switcher | **Your brain** · **Tunnel to…** (menu) or list of people with a tunnel icon | Avoid “Other brains” and “Braintunnel” in the same breath as the app chrome. |
| Row / header for an outbound thread | **Donna** + avatar; optional line **Via tunnel** or **Their assistant** | “Donna’s Brain” remains valid if testing shows “tunnel” overused. |
| Inbound section | **Inbound** or **To your brain** | Do not call this “Tunnels in” unless we enjoy explaining bidirectional networking. |

**Defer until copy testing:** locking the string table. Ship candidates: **Tunnels** vs **Other brains** for the section; **Tunnel to…** vs **Someone else’s brain** in the picker.

**Bottom line:** **Yes — introduce “tunnel” for the outbound grant-chat bucket** (section + switcher), where it reinforces *scoped access through a wall*. **No — do not** rename the product or repeat **Braintunnel** inside feature copy for each connection. **Inbound** stays plain and task-focused.

---

## The chat list redesign

The biggest UX question is: where do these conversations live and how do users tell them apart?

### Three conversation types

| Type | Who you're talking to | Direction | Visible to |
|------|----------------------|-----------|------------|
| **My Brain** | Your own agent (current today) | You → your agent | You |
| **Tunnels** (outbound) — *alt: “Other brains”* | Someone else's grant-gated agent | You → their agent | You |
| **Inbound** | You are the answerer | Someone else → your agent | You (as the owner of the brain being queried) |

### One thread per tunnel (not multiple chats with the same person)

**Decision:** **No** — do **not** offer multiple parallel conversations with the same peer’s tunnel. **One DM-style thread per grant relationship** (outbound): single scrollable history with that person, like Messages or Slack DMs, not like “new chat” sprawl.

**Why this matches the product**

- **Follow-ups depend on context** — “what about last quarter?” only works if the prior turn is in the same thread. Splitting into several tunnel chats forces users to guess which thread had the answer or duplicates questions.
- **Nav stays sparse** — at most **one row per person** under **Tunnels**; multiple tunnels to the same user would feel broken and clutter the list.
- **Mental model:** a tunnel is a **relationship line**, not a disposable workspace. You’re not “opening a new document” each time you ping Donna; you’re continuing the same line of dialogue.

**Intentional contrast with My Brain**

| | **My Brain** | **Tunnels** (outbound to one peer) |
|---|----------------|-------------------------------------|
| Metaphor | Many chats = **separate contexts / goals** (work vs personal, different projects) | **One rolling transcript** per peer |
| Sidebar | Multiple rows (today’s notes, planning, …) | **One row per person** you can reach |
| “New chat” | Creates another **local** session | For a tunnel peer, **reopens or continues** the single thread — no “Tunnel chat 2” |

That is **two metaphors in one app**, which is acceptable: the same people already separate “my notes / threads with myself” from “DM with Alex” in other tools. The risk is only **confusion if copy doesn’t label sections** — **My Brain** vs **Tunnels** must stay visually distinct.

**History and context (UX + architecture)**

- **UI:** Long threads **scroll indefinitely** (with lazy loading / virtualization for performance). Nothing stops you from reading old turns.
- **Model context** (their side when answering): Bounded by **policy + budget** — e.g. last *N* turns included in the prompt by default, optional **summarize older thread** for very long DMs, or retrieval over the tunnel transcript later if we add search. The user still **sees** full history in the client unless we explicitly add “clear thread” (unlikely v1).
- **Architecture:** One `chat_session` row per `(tenant, session_type=b2b_outbound, peer_grant_or_handle)` with a **uniqueness constraint** — no duplicate sessions per peer. Simpler routing and notifications (“open the Donna tunnel” is unambiguous).

**Edge cases (later)**

- **Grant revoked and re-issued** — same human, new grant row: prefer **continuing the same thread** if the peer identity is stable; only fork if we ever need a hard audit break (product call).
- **“I need a clean slate”** — rare; if it appears, prefer **optional archive + new thread** behind an advanced action, not first-class “new tunnel to Donna.”

---

### Recommended layout: sections within the chat sidebar

The chat list gains **sections** rather than mixing all three types in a flat stream. This mirrors how messaging apps distinguish "Direct Messages" from "Channels" or how mail clients separate Inbox from Sent.

```
╔══════════════════════════╗
║  My Brain                ║  ← collapsible section header
║  ┌─────────────────────┐ ║
║  │ Today's notes       │ ║
║  │ Project planning    │ ║
║  │ ...                 │ ║
║  └─────────────────────┘ ║
║                          ║
║  Tunnels                 ║  ← outbound B2B (see § Terminology)
║  ┌─────────────────────┐ ║
║  │ Donna                 ║  ← person + optional “via tunnel” hint
║  │ Alex                  │ ║
║  └─────────────────────┘ ║
║                          ║
║  Inbound  (2)            ║  ← section: others asking your brain
║  ┌─────────────────────┐ ║
║  │ Marcus → Your Brain │ ║  ← "waiting for approval" badge if pending
║  └─────────────────────┘ ║
╚══════════════════════════╝
```

**Why sections, not a flat list or separate routes?**
- A flat list would bury inbound queries among your own chats; you'd miss them.
- A separate page/route would be a dead end — the whole point is that all conversations are the same kind of thing.
- Sections keep the "chat" mental model while making identity legible at a glance.
- Sections can collapse; inbound section badge count stays visible even when collapsed.

**Identity in the conversation header.** When you open an outbound tunnel chat, the header names the person (and/or **their assistant**; optional **via tunnel** affordance). Your own brain chats remain unnamed or carry your own identity. This is the primary UX signal for "who am I talking to."

### New chat: default your assistant, one-tap brain switch

The **new chat** surface (blank composer, “start fresh” from the chat list) should **not** feel like a second app. It is the same chat chrome you already use; the only extra affordance is **who the next message is addressed to**.

**Default target:** **Your assistant** — same as today. Opening “New chat” or landing on chat with no session selected starts in **My Brain** mode: full local agent, your tools, your visible tool stream. Nothing surprises existing users.

**Brain switcher (outbound only):** In the **header** (or immediately above the composer, if the product keeps the title there), add a compact **target control** — e.g. a segmented row, pill, or dropdown labeled for clarity:

- Primary line: **Your Brain** (selected by default), with your avatar or product icon.
- Secondary list, only when `brain_query_grants` gives you at least one person who has granted you access: **Donna**, **Alex**, … (tunnel / “their assistant” affordance so it never reads as impersonating the human in DMs).

**Interaction model:**

1. User hits **New chat** → composer is empty, **Your Brain** is selected; first message creates a normal **My Brain** session (today’s behavior).
2. User opens the target control and picks **Donna** (tunnel) → selection updates **before** they type; the header subtitle or chip makes the recipient explicit (e.g. **Tunnel to Donna** or **Donna’s assistant**). The empty state can copy-line once: “Questions here are answered from Donna’s side, within what she allowed. You won’t see her raw mail or files.” First send creates or continues the **one DM-style thread** with that grant (see “one conversation per grant” below).
3. User switches **back** to **Your Brain** without sending → they stay on the new-chat screen but the pending recipient resets; no orphan half-thread.
4. **No grants:** show only **Your Brain** in the control (or show **Tunnels** / “talk to someone else’s brain” disabled with “No one has granted you access yet” → deep link to **Hub → Brain access** / invite flow). Avoid surfacing a list that errors on send.

**Why header / composer-adjacent, not only the sidebar?** The sidebar sections are great for **returning** to an ongoing thread. The switcher on **new chat** makes “talk to someone else’s brain” **discoverable in the moment** you’re about to type — same gesture as picking a recipient in Slack or Messages, without hunting the list for “Donna” first.

**Consistency:** Picking someone from the switcher should mirror picking the same row under **Tunnels** in the list — same thread key (grant + peer), so the UX never forks into two ways to create duplicate conversations.

---

## Outbound B2B chat (you ask someone else's brain)

When you open a conversation under **Tunnels** and type a message:

1. Your message is sent to the other tenant's server.
2. Their server runs a **restricted agent** — a separate agent profile with a minimal, read-only tool set scoped to what their grant policy allows (wiki reads, mail summary, calendar free-busy, etc.). No tool call results, no raw file contents, no filesystem paths cross the boundary; only the synthesized answer.
3. The answer streams back to your chat. It looks exactly like a normal chat reply, just from a differently named assistant.
4. Tool calls on their side are **never visible to you.** You see only the final message. (This is different from your own chat where you see thinking and tool calls.)
5. Conversation history is stored on **your** side as a normal chat session (same `var/brain-tenant.sqlite` chat table). Their side may or may not store a log depending on their setting.

### The outbound agent is fundamentally different from your own agent

| Your Brain agent | B2B outbound agent (their side) |
|-----------------|-------------------------------|
| Full tool set: wiki read/write, mail, calendar, files, web | Restricted tool set per grant policy |
| Sees all your data | Sees only what the grant allows |
| Tool call results visible in chat | Tool calls invisible; only the answer crosses |
| Streams thinking steps | No thinking visible; result-only stream |
| Follows your system prompt | Follows the grant's privacy policy + owner's profile |

---

## Inbound B2B (someone asks your brain)

When a grant-holder opens a chat with your brain and sends a message, you see it in the **Inbound** section. The conversation appears like a chat thread showing the other person's name ("Marcus is asking your brain").

### With human approval enabled (default for new grants)

This is the "approve before send" experience the user described:

1. Marcus sends a message.
2. Your brain runs the restricted research pass (same policy-filtered agent as outbound).
3. A **draft answer** appears in your Inbound conversation, with a badge or indicator: **"Waiting for your approval."**
4. You can:
   - **Approve** — sends the answer to Marcus as-is.
   - **Edit and approve** — revise the draft, then send.
   - **Decline** — sends a refusal; Marcus sees a generic "unable to answer" response.
5. Marcus's chat shows a typing indicator or "thinking..." state while your approval is pending. If you take a long time (configurable timeout), Marcus gets a "response is pending review" message.

### With auto-respond enabled (trust ladder, opt-in per grant)

Same flow as above, but step 3 automatically triggers step 4 without waiting for you. You still see the conversation in Inbound for your own reference.

### What you see in Inbound

The Inbound thread shows:
- Marcus's original question (verbatim — you always see what was asked)
- The draft answer your brain prepared
- The policy filter pass result (redacted/rewrote any violations)
- Your action (approved / edited / declined) and when
- Delivery status

This is better than the old audit log approach: it's a **live workflow surface**, not a historical report.

---

## What gets removed / rethought

| Current thing | New thing |
|---|---|
| `[braintunnel]` email marker as B2B transport | Chat session as transport |
| `brain_query_mail` notification kind | Inbound B2B chat session (notification still fires to open it) |
| `ask_brain` agent tool | User opens a tunnel chat (picker or **Tunnels** list) |
| Email-based answer delivery | Chat message stream |
| "Brain query" as a separate product surface | Part of the unified chat list |
| Mail composition UX for B2B | Normal chat input |

**What stays:**
- `brain_query_grants` table and all CRUD — no change to the trust model
- Grant-gated access (only open a B2B chat if a grant exists)
- Privacy policy per grant (now used to configure the inbound agent, same three-layer model)
- Notification infrastructure (fires when a new inbound message arrives, links to the Inbound chat)
- The policy model: capabilities, hard predicates, soft fragments

---

## Technical sketch

### New data model additions

- **One outbound session per peer** — uniqueness on `(tenant_id, session_type='b2b_outbound', remote_grant_id or stable peer key)` so the nav never lists duplicate tunnels to the same person.
- `chat_sessions` gets a `session_type` discriminant: `'own'` (existing), `'b2b_outbound'`, `'b2b_inbound'`
- `b2b_outbound` sessions have a `grant_id` FK and a `remote_tenant_handle`
- `b2b_inbound` sessions have a `grant_id` FK and an `asker_handle`
- Inbound sessions gain an `approval_state` column: `'pending'` | `'approved'` | `'declined'` | `'auto'`

### New API surface

- `POST /api/chat/b2b` — initiates or continues a B2B outbound message; server routes to the grant owner's tenant, runs restricted agent, streams answer back
- `GET /api/chat/b2b/inbound` — lists inbound B2B sessions for the current user
- `POST /api/chat/b2b/inbound/:sessionId/approve` — approves and delivers the pending draft
- `POST /api/chat/b2b/inbound/:sessionId/decline` — sends refusal

### The restricted outbound agent

A new agent profile (separate from the standard chat agent) that:
- Uses a tool set derived from the grant's capability layer (no write tools, no cross-tenant wiki paths)
- Wraps incoming query in a sanitized delimiter block (prompt injection defense)
- Runs the privacy filter pass before any response leaves the tenant
- Never exposes tool call results to the calling side — only the final message

---

## UX open questions

1. **Conversation starters.** When you first open a tunnel chat, what's the empty state? Suggested questions based on what they've granted you? Just an empty composer?
2. **Typing indicator.** Should Marcus see a live typing indicator / "thinking" while your brain runs and you're approving? Or a static "response pending"? The former is more chat-native; the latter is more honest about async approval latency.
3. **Naming the sections.** Default recommendation is in [§ Terminology](#terminology-braintunnel-vs-tunnel-in-the-feature) (**Tunnels** + **Inbound**); validate with usability (“Tunnels” vs plain **Other brains**). Residual options: **People** / **Requests**; **Connected brains** / **For review**.
4. **~~One conversation per person or multiple?~~** **Resolved:** [§ One thread per tunnel](#one-thread-per-tunnel-not-multiple-chats-with-the-same-person) — one DM-style thread per peer; My Brain stays multi-chat by design.
5. **Mutual vs. one-way.** If Donna grants you access and you grant Donna access, do you have one shared thread or two separate ones (one under **Tunnels**, one under **Inbound**)? Probably two separate threads with different agents — the grant policy can differ in each direction, so the conversations are genuinely different.
6. **Mobile / small screen.** The sections sidebar needs to work at narrow width. Possibly a bottom tab bar with "My Brain" / "Tunnels" / "Inbound" tabs instead of a sidebar.
7. **Notification badge placement.** The Inbound section badge (pending approvals) needs to be prominent — probably also surfaced in the notification bell / brief so it's impossible to miss.

---

## Relationship to existing infrastructure

This is an **evolution, not a replacement**, of the B2B data model:

- Grants remain the trust primitive.
- Policy model (three layers) governs the inbound restricted agent — no change there.
- Notification rows in `brain-tenant.sqlite` fire when a new inbound session arrives; you tap the notification to open the Inbound chat.
- `BRAIN_B2B_ENABLED` still gates the feature.
- The mail path (`[braintunnel]`, `brain_query_mail`) can be deprecated once this is working — but can coexist during transition as a fallback for users without cloud.

The big architectural shift is that **the synchronous cross-tenant request is now driven by a chat turn rather than a mail message**, and the answer returns in the same chat session rather than as email.

Persisting tunnel-derived knowledge into **your** wiki (and related inbound UX polish) is **[OPP-111](OPP-111-tunnel-fast-follows.md)** — same trust boundary; wiki capture runs on the asker’s tenant only.

---

## Why this is the right direction

The email-first transport was correct as an MVP — it avoided building a real-time cross-tenant message bus. But it produced a disjointed UX: the B2B "conversation" was scattered across your inbox, your chat history, and Hub audit logs. Users had no single place to see "my conversation with Donna's brain."

The chat-native approach:
- **Unifies the UX** — one place (the chat list) for all conversations, regardless of who the agent represents
- **Reuses massive amounts of existing code** — the chat component, session persistence, streaming SSE, message rendering all work as-is
- **Removes friction** — no email composing, no subject lines, no inbox hunting for replies
- **Makes the approval flow natural** — instead of "check Hub logs for pending answers," it's "a message in your Inbound section is waiting"
- **Scales to the product vision** — the long-term Braintunnel story is a network of **tunnels** to other minds; a **Tunnels** section plus **Inbound** is the right chat primitive (see [§ Terminology](#terminology-braintunnel-vs-tunnel-in-the-feature)).
