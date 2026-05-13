# Archived: OPP-111 — Tunnel fast follows

**Status: Archived (2026-05-12).** **Shipped:** Save-to-wiki for **tunnel replies** (initiator tenant); **Review** queue (single nav + badge), per-grant **auto-send** vs **review-before-send**, pending/sent semantics, neutral tunnel copy/icons, honest egress vs My Brain surfaces. **Stub:** [../OPP-111-tunnel-fast-follows.md](../OPP-111-tunnel-fast-follows.md)

---

# OPP-111: Tunnel fast follows

**Status:** Archived (2026-05-12) — narrative retained for reference.

**Prerequisite:** [OPP-110](../OPP-110-chat-native-brain-to-brain.md) (stub; **full spec:** [OPP-110-chat-native-brain-to-brain.md](OPP-110-chat-native-brain-to-brain.md)) · **Policy context:** [brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md)

This opportunity bundles **post-v1 tunnel polish** that does not need to ship in the same milestone as the core tunnel cutover, but should be designed as a coherent “second lap”: **(A)** compounding **tunnel replies** into **your** wiki on the initiator’s side, and **(B)** a **triage-first answering-side** experience — send gating, clear delivery semantics, and UI that does not pretend peer-boundary replies are the same as **My Brain** chat.

**Scope: DM-shaped traffic, not quiz-only.** The familiar story is *A asks B’s brain a question*, and that remains a **common** opener — but tunnels should match how people actually message (cf. **Messages**, **Telegram**): **FYI**, **heads-up**, **request**, **instruction**, **nudge**, or **question**; often **expects or invites a reply**, but not always, and not every opener is “a question.” Whatever A sends under the grant, B’s stack still **drafts** (and maybe **auto-sends**) a **response** subject to policy; **review-before-send** gates **egress**, not “whether it was a question.” Specs, **copy**, and **icons** should not assume Q&A is the **only** reason A initiates.

---

## A. Capture tunnel replies into your wiki (initiator tenant)

### Problem

A natural workflow after OPP-110 is: you **messaged another brain** through a tunnel (question, request, or anything else the grant allows), got a useful **reply**, and you want that knowledge in **your** wiki — durable, linkable, consistent with the compounding-wiki story.

That must **not** blur the trust boundary OPP-110 defines: the **remote** restricted agent reads **their** corpus (their wiki, mail, etc. per grant). It does **not** need read access to **your** wiki to **reply** to you, and it must **not** receive write access to **your** vault.

So “put this into my wiki” is a **second step on the initiator’s tenant**, not an extra tool on the remote side.

### Design principle

| Layer | Who acts | What touches your wiki |
|--------|-----------|-------------------------|
| **Tunnel (OPP-110)** | Remote restricted agent | Nothing of yours — only **text replies** stream back. |
| **Capture (this slice)** | **Your** app / **your** assistant | **Your** wiki read/write, only after you choose to save or compose locally. |

This does **not** change OPP-110’s fundamentals; it **composes** tunnel output with normal My Brain capabilities.

### Directions (not mutually exclusive)

1. **Minimum viable — always possible:** copy from the tunnel transcript; v1 can ship without extra UI.
2. **Save to wiki (or “Add to wiki”):** Client or server action on **your** tenant only — optional path picker, optional title, write markdown derived from selected message(s). Attribution line optional (“From tunnel with @donna, …”).
3. **Continue in My Brain:** One gesture to open a **My Brain** chat with the last tunnel **reply** (or selection) **attached as context**, so your **full** assistant can expand, merge with existing notes, or place content using existing wiki tools.
4. **Later:** search across tunnel threads, batch export — still local to your tenant.

### UX considerations (wiki capture)

- **Never** expose wiki tools to the remote tunnel agent for “convenience.” If the user wants their own notes to shape **their next message in the tunnel**, that’s switching back to **My Brain** or reading the wiki themselves — not plumbing their vault into the remote agent.
- **Provenance:** users may want it clear that a paragraph came from **another brain** via policy-filtered synthesis, not from their own research — optional template in the saved page.
- **Parity (answering side):** the host may also want to log **what left toward a peer** locally; that can mirror the same patterns on **their** wiki (separate from cross-tenant capture).

### Technical sketch (wiki capture, light)

- Reuse existing wiki write pathways on the **initiator** tenant (same tools the My Brain agent already uses), triggered from UI or from a dedicated **local** agent turn — not from the cross-tenant tunnel RPC.
- Tunnel session rows already store transcript on your side ([OPP-110](../OPP-110-chat-native-brain-to-brain.md)); capture actions reference `session_id` + message id(s).

---

## B. Answering-side UX — review queue, send control, honest surfaces

*Engineering and policy docs may still say **inbound** (messages arriving at your tenant). **Product copy** should favor task language — **Pending**, **Requests**, **Review** — not “inbound” or networking metaphors.*

### Problem

1. **Send gate.** Early implementations may **auto-send** the restricted agent’s **draft reply** to the remote peer as soon as it is generated — regardless of whether A’s opener was a **question**, a **request**, or **FYI**. Many users need the opposite default: **nothing crosses the tunnel until they release it** (or a deliberate trust mode allows auto-send). The host should choose **auto-send** vs **review before send** per relationship or default — see [brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md).

2. **Wrong surface metaphor.** Modeling the answering workflow as **another chat thread in the sidebar — one row per peer** invites the wrong habit. The **common case** is **clear the queue**: open, confirm (or lightly edit), send, next. That is closer to **triage** or **sign-and-ship** than to an open-ended **My Brain** session. Putting **N peers** in the left nav as separate “inbound chats” optimizes the rare case (long back-and-forth with one person) and clutters the frequent one (**many short approvals**).

3. **Misleading chrome.** If the **same** transcript layout and composer as **My Brain** appear on the answering side, users assume typing = **what the peer receives**, or that the assistant’s draft is **private** until they “send” a chat message — none of which is guaranteed unless the UI says so. **Tunnel replies** are **policy-shaped egress**, often **agent-drafted first**; the composer might mean **steer the local agent**, **edit the pending egress text**, or **human-only message** — three different meanings that must not be collapsed.

Without a deliberate model, the UI **lies**; people may leak, withhold, or distrust the feature by accident.

### Design vision: two surfaces, two metaphors

| Surface | Job | Metaphor |
|--------|-----|----------|
| **Chat** (sidebar **My Brain** + **Tunnels**) | Ongoing dialogue: you with your assistant; **you** with **another brain** via a tunnel (one rolling thread per peer, per archived OPP-110). | Conversation |
| **Review** (single queue entry; see below) | **What leaves your tenant toward a granted peer**: pending **draft responses** (whether A asked, told, or instructed), approve/edit/decline, **already sent** for verification when you trust auto-send. | Inbox / outbox triage — **short stack**, not one nav item per person |

**Principle:** Do not require the host to **hunt** “which sidebar thread is asking for approval?” Scatter is for **Tunnels** (relationship lines you chose to open). **Peer messages** (under the grant) that need a **human gate** before **egress** should aggregate into **one working queue** (with filters), analogous to the **brief / prioritized items** story in [IDEA-anticipatory-assistant-brief.md](../../ideas/IDEA-anticipatory-assistant-brief.md) — *emotionally small*, badge-driven, deep-linkable. The opener may or may not be phrased as a question; the queue row is still **“needs your OK to send”** or **“draft ready.”**

### Navigation and hierarchy

- **One** primary entry for the answering workflow — e.g. **Pending**, **Review**, or **Requests** (copy-test against **Needs you** / **For you to send**). **Badge** = count of items requiring **human action** (approve, edit, or decline — not passive “unread chat”).
- **Do not** list **one sidebar row per requesting peer** for this workflow. Optional **“Open full thread”** from a queue row can jump to **read-only or history** for that **relationship + turn**, without owning the main nav.
- **Collapsible integration:** the same pending items may **surface** as rows on **empty chat** (brief strip) so landing in Chat still says “here is what needs you” without duplicating a second Gmail-scale inbox.

### User flow (happy path + branches)

**Triage (default)**

1. User opens **Review** (or taps a brief line, e.g. *“@alex — draft ready”* with a **snippet** of what they sent — whether it reads as question, request, or FYI).
2. **Dense list:** peer, **snippet** of **their message** (first line / subject line — no assumption it contains a question mark), **state** (needs you / sent / couldn’t send), **time**. Sort: **action required first**.
3. **Primary action** on a row: **Send** / **Approve & send** when the draft is acceptable.
4. Secondary: **Edit & send**, **Decline** (or **can’t reply** / **pass** when there is nothing appropriate to send — avoid copy that implies every item is a **question** you failed to **answer**), later **Snooze** if the notification model supports it.

**Steer or rewrite (secondary)**

1. Open row → **detail pane** (not “just another chat”).
2. Show **three layers** clearly: **their message** (verbatim) · **your assistant’s proposed reply** · **what will cross** / **what crossed** the tunnel after approval.
3. **Instructions to your agent** (regenerate, tone, constraints) live in a **labeled** control — never ambiguous with “message to peer.” **Inline edit** of pending egress vs **Regenerate** — product choice; both should make **what ships** obvious before confirm.

**Trust / auto-send**

- When **auto-send** is on for a grant, the queue still shows **Sent** (and optional **View**) so “trust but verify” stays **one tap**, not a Hub audit log.

**Empty state**

- Calm, **warm workstation** tone ([DESIGN.md](../../../DESIGN.md)): nothing pending should feel like **completion**, not an empty chat thread.

### Send control (policy + UI)

- **Per grant / counterparty / global default (TBD):** **Auto-send after filter** vs **Review before sending** (plain-language labels in UI).
- When review is required, agent output stays **pending** until the host **releases** it. States in data and UI: at least **draft / awaiting you / sent / failed** so history scans unambiguously.
- **Defaults** (new grant vs trusted tie) are a **product + policy** decision; align with the **trust ladder** described in [IDEA-anticipatory-assistant-brief.md](../../ideas/IDEA-anticipatory-assistant-brief.md).

### Terminology (UI)

| Avoid in user-facing copy | Prefer |
|---------------------------|--------|
| Inbound, outbound, egress | **Pending**, **Sent**, **What they’ll receive**, **Review before sending** |
| Framing **only** as Q&A (“ask,” “question,” “answer” as universal labels) | **Message**, **From @peer**, **Reply**, **Draft**, **Conversation** — use **question** when the **content** is actually a question |
| Reverse tunnel | **From @peer**, **They messaged you**, or section names like **Review** / **Pending** |
| *(Engineering)* | Keep **inbound** in code, logs, and architecture docs where precise |

### Copy and iconography (don’t quiz the whole product)

- **Icons:** avoid treating **question-mark** or **“Q”** glyphs as the **default** tunnel or queue affordance unless the UI knows the item is question-like. Prefer **message bubble**, **thread**, **person/avatar**, or **neutral send/reply** motifs — patterns familiar from **Messages** / **Telegram** — so FYIs and instructions don’t look like bugs.
- **Templates and empty states:** don’t imply “nobody asked anything.” Use **nothing pending**, **no replies to review**, **all caught up** — not “no questions.”
- **Optional later:** lightweight **intent hints** (e.g. icon or chip for **FYI vs. needs reply**) if telemetry or shallow classification supports it — **not** required for v1 if copy stays neutral.

### Open implementation questions

- **Queue ↔ thread:** single **notification / item** model vs mirroring chat rows — must **deep-link** into the detail view and **mark handled** without stranding users ([brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md#notification-inbox-and-human-in-the-loop-prerequisite-for-secure-brain-to-brain)).
- **Composer layout:** single field with **mode** vs **Draft preview** + **Notes to agent** + primary **Send**.
- **Human-only path** to peer, if first-class: explicit **second control** or mode — never confused with My Brain or wiki.
- **Badges:** optional OS notification when **awaiting you**; in-app badge on **Review** is authoritative if push is off.

---

## Relationship to OPP-110

**[OPP-110](../OPP-110-chat-native-brain-to-brain.md)** is **archived** (2026-05-12); it defines tunnel threads, message storage, and trust boundaries. Implement this opportunity as a **focused second lap**: wiki capture on the **initiator** side **and**, on the host side, **a triage-first review queue + send gating + honest egress semantics** (for **any** granted tunnel message shape, not only questions) — without widening cross-brain trust or implying vault access the remote agent does not have.
