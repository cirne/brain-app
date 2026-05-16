# Slack personal ambassador — your Brain in your team's Slack

**Status:** Backlog — no OPPs yet; pre-product  
**Index:** [IDEAS.md](../IDEAS.md)  
**Relates to:** [VISION.md](../VISION.md) (context engine), [STRATEGY.md](../STRATEGY.md) (trust moat), **[IDEA-brain-query-delegation](IDEA-brain-query-delegation.md)** (B2B tunnel model; Slack is a new intake channel for the same draft→review→send flow), **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** (Slack approval notifications appear in the brief queue; same notification substrate), [IDEA-local-bridge-agent](IDEA-local-bridge-agent.md) (desktop idle detection for presence-aware auto-reply toggle)

---

## Problem

When you're away, unreachable, or simply heads-down, colleagues have two options: interrupt you (Slack ping, email) or give up and wait. Neither is good. Meanwhile, a large fraction of what colleagues actually need from you lives in your Braintunnel wiki and email corpus — it's *already been synthesized* — but it's invisible to them unless they happen to have a Braintunnel grant and know to use it.

Slack has no concept of a per-person intelligent assistant. Slack AI (Business+ / Enterprise+, 2026) operates on workspace-level shared context — channels, shared files, Salesforce data. It has no access to your private wiki, your years of email, or your individual communication patterns and preferences. To Slack, every user is a blank box.

The existing B2B brain-query delegation path ([IDEA-brain-query-delegation](IDEA-brain-query-delegation.md)) solves this for Braintunnel-to-Braintunnel queries, but colleagues who don't have Braintunnel — or who would never think to query it — are still locked out.

---

## The vision

When a team adds Braintunnel to their Slack workspace, every enrolled Braintunnel user gets a **personal AI ambassador** — a representation of them in Slack that can answer questions on their behalf, triage incoming requests while they're away, and route real decisions back to them for approval.

The ambassador's answers are drawn from the user's private wiki, indexed email corpus, and calendar context — the compounding personal knowledge graph that no workspace-level AI tool can replicate. The longer someone has used Braintunnel, the better their ambassador gets.

From a colleague's perspective, the experience is frictionless: DM `@Braintunnel` or mention it in a channel, ask something, get a useful answer in seconds. From the user's perspective: nothing gets sent out that they haven't sanctioned, and the approval flow is as low-friction as tapping a button in Slack.

---

## Why this is differentiated from Slack AI

|  | Slack AI (2026) | Braintunnel ambassador |
|---|---|---|
| Knows your private email corpus | ❌ | ✅ Years of indexed mail |
| Knows your personal wiki | ❌ | ✅ Compounding knowledge graph |
| Knows your relationships and history with each person | ❌ | ✅ `people/*.md` pages, contact graph |
| Can answer in your voice | ❌ | ✅ Style learned from wiki + mail |
| Per-contact response policies | ❌ | ✅ Custom rules per requester |
| Gets smarter over time | ❌ | ✅ Each interaction feeds the wiki |
| Represents *you*, not the team | ❌ | ✅ |

The compounding wiki is the true moat. Every well-handled Slack interaction reinforces the wiki context that generated it. The ambassador that a colleague talks to in year 2 is categorically better than year 1, because the wiki is richer.

---

## Core mechanics

### Team install + per-user enrollment

1. A workspace admin installs the Braintunnel Slack app (one install per workspace).
2. The Braintunnel bot DMs every user: *"Your team uses Braintunnel. Connect your account to enable your personal assistant."*
3. Each user clicks through a short OAuth flow. If their Slack email matches a Braintunnel account, it's auto-suggested.
4. Non-Braintunnel users on the team never need to install anything — they interact with enrolled users' ambassadors through the shared bot.

### How a Slack user reaches someone's ambassador

There are three entry points:

**A. DM with the Braintunnel bot**
`@Braintunnel: I need Alex to weigh in on the API migration scope before Friday.`
Braintunnel identifies the target (Alex), searches his wiki and mail for API migration context, drafts a response, then sends Alex an approval notification (see below) before posting.

**B. @mention in a channel**
`@Braintunnel what does Sarah think about the Q4 OKR framing?`
Braintunnel queries Sarah's wiki and mail for Q4 OKR context, applies her default channel policy, and responds in the thread — with attribution.

**C. Via Slack status signal**
When Alex has ambassador mode active, his Slack status reads: `🧠 Braintunnel active — try @Braintunnel`. Colleagues who see this know how to engage, without needing to know the exact DM pattern.

### Presence-aware toggle

The ambassador can be active or dormant. Control modes, roughly in order of preference:

- **Explicit toggle** in Braintunnel settings (or Slack App Home) — cleanest, always works
- **macOS idle detection** via the desktop app ([IDEA-local-bridge-agent](IDEA-local-bridge-agent.md)) — auto-enable after N minutes of idle, auto-disable when active; this removes the "I forgot to turn it off" problem
- **Scheduled hours** — "auto-enable outside 9–6 Mon–Fri" as a fallback for those without the desktop app

Slack's modern Events API has no presence webhooks (the RTM API that supported `presence_sub` is deprecated as of 2025). Polling `users.getPresence` at low frequency is available as a weak signal but explicit toggle is the primary path.

When the ambassador activates, Braintunnel calls the Slack user status API to set the `🧠 Braintunnel active` status (and clears it when deactivated).

---

## Policy system

Every enrolled user gets a **default response policy** and can layer **per-contact overrides** on top.

**Default policy fields:**
- Mode: `off` / `always` / `away-only` / `scheduled`
- Response style: concise / full context / triage-only (just ping me)
- Auto-send vs. always-review (see below)
- Out-of-scope handling: "If you can't answer from the wiki, say so and offer to flag me"

**Per-contact overrides (keyed by Slack user ID or email):**
- Override mode (e.g. "for my manager, always-on")
- Override style (e.g. "for cold/unknown senders, triage-only and do not reveal details")
- Trust level: auto-send allowed vs. always require my approval regardless of policy

Policy lives in Braintunnel settings, not in Slack. Slack App Home surfaces a read-only status view and a button to open Braintunnel settings.

---

## The reply and attribution format

Every ambassador response carries a transparent attribution footer. Users should never wonder if they're talking to a bot. The attribution line is also the product's primary organic acquisition surface.

```
This response was sent by Alex's Braintunnel assistant, 
based on his wiki and email context.
Alex has been notified. · Get your own → braintunnel.app
```

The "Get your own →" line is the Braintunnel equivalent of "Sent from iPhone" — every reply is a distribution event reaching a warm audience (teammates) who have just seen the product work.

The bot's reply is posted with the user's avatar and display name (Slack allows custom usernames for bots on paid plans) so it reads naturally while still being clearly marked as an assistant.

---

## Approve draft replies from Slack

This is the key interaction pattern that separates Braintunnel from a dumb auto-reply bot.

When the ambassador generates a draft response and the user's policy requires approval (or the system has low confidence), instead of posting publicly it sends the user a **private Block Kit message** in Slack with the full draft:

```
🧠 Draft reply ready — Alex Martinez asked about the API migration

> "Alex, happy to share Sarah's thinking here. Based on what I know,
>  the migration scope is scoped to the auth service in Q3; the 
>  data-plane work is Q4. Sarah flagged two open questions last week
>  on the timeline for the legacy token revocation..."

[Send]  [Edit first]  [Decline]
```

- **Send** — posts the reply immediately, marks notification handled
- **Edit first** — opens a Slack modal with the full draft text in an editable textarea; user edits and confirms
- **Decline** — does not send; optionally adds a note back to the requester ("Sarah will follow up directly")

This approval flow is the Slack-native surface of the same human-in-the-loop review model that already exists in Braintunnel's B2B tunnel (`/api/chat/b2b` — review queue, approve/decline). The Slack interaction just adds a low-friction ambient surface for the approval: the user doesn't need to open Braintunnel.

The approval notification also appears in the **Braintunnel brief queue** ([IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)) under a new `slack_ambassador` source kind, for users who prefer to handle it there rather than in Slack.

---

## Channel presence: @Braintunnel as team tool

Beyond individual DM auto-replies, the bot can be invited to any channel. In channel context:

- `@Braintunnel what does Lisa know about the infrastructure costs?` — queries Lisa's wiki on topic if Lisa is enrolled and her channel policy permits
- `@Braintunnel is Tom available Thursday afternoon?` — checks Tom's calendar context from the wiki (not live calendar unless explicitly shared)
- `@Braintunnel` without a target — responds as a general Braintunnel assistant for the workspace (drawing on enrolled users' shared, policy-permitted knowledge)

Channel responses are always public within the channel and always attributed. More conservative defaults apply in channels than in DMs: policy defaults to "answer only from wiki, not from email" to reduce accidental disclosure.

---

## Digest and review in Brain Hub

The Brain Hub gets a **Slack handled** card in the background status / notification area:

- "While you were away: 4 messages handled. 1 needs your follow-up."
- Drill in to see each conversation: what was asked, what was sent, was it approved or auto-sent
- Actions: "follow up directly," "that was wrong — update my wiki," "good answer — this can be auto-send in future"

The "that was wrong — update my wiki" path is valuable: it routes the user directly to the wiki page that generated the bad answer, so they can correct it. This is the wiki feedback loop in a tight UX.

---

## The wiki feedback loop

Every successfully handled Slack interaction is an opportunity to strengthen the wiki:

1. User approves a reply → Braintunnel marks that wiki section as "confirmed useful for ambassador context"
2. User corrects a wrong reply → Braintunnel surfaces the source page for editing
3. Patterns of questions Braintunnel *couldn't* answer → surfaced as wiki gaps ("You were asked about X three times this month but your wiki has no page for it")

This is the compounding dynamic from [OPP-033](../opportunities/OPP-033-wiki-compounding-karpathy-alignment.md) applied to a social/communication surface. The wiki grows more useful in proportion to how much the ambassador is used.

---

## Relationship to brain-query delegation

The Slack ambassador is architecturally a new **intake channel** for the existing brain-query delegation system ([IDEA-brain-query-delegation](IDEA-brain-query-delegation.md)):

- A Slack DM or @mention becomes a `brain_query` event with `source: slack`
- The query is processed by the same agent (wiki search, email search, draft synthesis, privacy filter)
- The response enters the same draft → review → approve/send lifecycle
- The notification appears in the same `notifications` table with a new `slack_ambassador` kind

The Slack integration does not require a new agent pipeline — it reuses B2B tunnel infrastructure with a new transport adapter at the edges (Slack Events API in, Slack Block Kit message out).

---

## Acquisition flywheel

The non-Braintunnel user who receives a well-crafted Slack reply from their colleague's ambassador and sees the attribution footer is the highest-quality lead in the product's funnel: they've seen the product work, on a real use case, for someone they know. The "Get your own →" link in every footer is a warm, contextual CTA.

At team scale: if 20% of a Slack workspace enrolls Braintunnel and their ambassadors handle dozens of interactions a week, the remaining 80% are repeatedly exposed to the product. Unlike most B2B products, the value to non-users is *immediately visible* — they just got a useful answer.

This also provides a path into B2B sales: a champion at a company activates Braintunnel → their teammates see it → a team or org deal emerges organically.

---

## Phased breakdown (for future OPPs)

When ready to implement, this idea should be sliced into roughly these phases:

**Phase 1 — Bot + explicit toggle + default policy + DM only**
- Team install, per-user OAuth, Slack status sync
- Explicit "ambassador on/off" toggle in Braintunnel settings
- Default policy only (no per-contact overrides)
- DM-to-bot only (no channel presence)
- Full approval flow in Slack (Block Kit approve/edit/decline)
- Brain Hub "Slack handled" card (basic, list only)
- Attribution footer

**Phase 2 — Per-contact policies + channel presence + digest polish**
- Per-contact policy overrides (UI in settings)
- Bot invited to channels, channel-safe defaults
- Richer Brain Hub digest (conversation view, follow-up actions)
- Wiki gap detection from unanswerable questions

**Phase 3 — Presence-aware + wiki feedback loop + AgentExchange**
- Desktop idle detection → auto-enable/disable (via [IDEA-local-bridge-agent](IDEA-local-bridge-agent.md))
- Wiki feedback loop (mark good/bad answers, surface edit path)
- AgentExchange listing (Slack's unified agent marketplace, launched April 2026)
- Scheduled hours mode

---

## Open questions

1. **Slack API scope for bot-as-user:** Slack's API allows bots to post with a custom name/avatar but they are never fully indistinguishable from human users (by design). Does the ambassador reply come from a generic "Braintunnel" bot or from a per-user bot app? Per-user bot apps require Slack paid plan workspace-level app distribution — this may limit early testing.

2. **DM auto-reply access:** Slack's API explicitly does not allow third-party apps to read or respond to 1:1 DMs between two humans unless the app is invited. The ambassador model sidesteps this by routing *through* the bot (the human DMs the bot), but this requires a behavior change from the requester. Is that friction acceptable, or do we need a workflow automation that "forwards" DMs to the bot when the user is away? Workflow Builder can do this but it requires per-user setup.

3. **Policy UI placement:** Settings or App Home? Settings is more powerful; App Home is where Slack users expect to configure Slack apps. Probably settings-canonical, App Home as a status view + deep link.

4. **Privacy defaults for channel context:** How does the ambassador decide what is safe to share in a public channel? "Wiki only, not email" is a reasonable default, but needs formal policy shape.

5. **Multi-workspace support:** A user on two Slack workspaces should have one Braintunnel account driving both ambassadors. Is this a meaningful use case early enough to plan for, or defer?

6. **Latency:** Ambassador replies need to feel fast (< 5s ideally). Wiki + email search + LLM synthesis can be slow. Streaming to a Slack message (update-in-place) may be the UX answer, but Block Kit message updates have rate limits.

7. **AgentExchange eligibility:** As of 2026, AgentExchange requires Salesforce/Agentforce integration scaffolding for full listing. A standard Slack App Marketplace listing may be the more accessible early target, with AgentExchange as a Phase 3 distribution upgrade.
