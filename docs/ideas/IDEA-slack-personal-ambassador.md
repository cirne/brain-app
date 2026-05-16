# Slack personal ambassador — your Brain in your team's Slack

**Status:** Active — hello-world spike shipped (dev); identity + adapter in progress  
**Index:** [IDEAS.md](../IDEAS.md)  
**Shipped spike:** [archived OPP-116](../opportunities/archive/OPP-116-slack-hello-world-app.md) (Events API hello world, dev only; staging deferred)  
**Current OPP:** [OPP-117](../opportunities/OPP-117-slack-identity-and-messaging-adapter.md) (workspace + user OAuth link, messaging core, Slack adapter)  
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


|                                                       | Slack AI (2026) | Braintunnel ambassador               |
| ----------------------------------------------------- | --------------- | ------------------------------------ |
| Knows your private email corpus                       | ❌               | ✅ Years of indexed mail              |
| Knows your personal wiki                              | ❌               | ✅ Compounding knowledge graph        |
| Knows your relationships and history with each person | ❌               | ✅ `people/*.md` pages, contact graph |
| Can answer in your voice                              | ❌               | ✅ Style learned from wiki + mail     |
| Per-contact response policies                         | ❌               | ✅ Custom rules per requester         |
| Gets smarter over time                                | ❌               | ✅ Each interaction feeds the wiki    |
| Represents *you*, not the team                        | ❌               | ✅                                    |


The compounding wiki is the true moat. Every well-handled Slack interaction reinforces the wiki context that generated it. The ambassador that a colleague talks to in year 2 is categorically better than year 1, because the wiki is richer.

---

## Core mechanics

### Team install + per-user enrollment

**Prerequisite:** The workspace admin who installs the Braintunnel Slack app must have a Braintunnel account. This is a hard requirement — Braintunnel is the owner of all policy and identity state, so there must be at least one enrolled account to anchor the workspace installation.

1. A Braintunnel account holder (the workspace admin) installs the app into a Slack workspace.
2. The Braintunnel bot DMs every user: *"Your team uses Braintunnel. Connect your account to enable your personal assistant."*
3. Each user clicks through a short OAuth flow. If their Slack email matches a Braintunnel account, it's auto-suggested.
4. Non-Braintunnel users on the team never need to install anything — they interact with enrolled users' ambassadors through the shared bot.

A single Braintunnel account can connect to multiple Slack workspaces. Each workspace installation is a separate connection, with its own integration-scoped policy (see below).

**The bot is a single shared Braintunnel bot**, not a per-user bot. Replies are posted as the Braintunnel bot with the target user's name in the text or attribution line, not as a custom bot per person. This keeps the Slack app manifest simple and avoids distribution constraints that per-user bot apps impose.

### How a Slack user reaches someone's ambassador

There are two interaction surfaces:

**A. DM with the Braintunnel bot**
`@Braintunnel: I need Alex to weigh in on the API migration scope before Friday.`
Braintunnel identifies the target (Alex), searches his wiki and mail for API migration context, drafts a response, then sends Alex an approval notification before posting.

**B. @mention in a channel**
`@Braintunnel what does Sarah think about the Q4 OKR framing?`
Braintunnel queries Sarah's wiki and mail for Q4 OKR context, applies her policy (within the workspace integration policy), and responds in the thread with attribution.

**Out of scope:** Intercepting or auto-replying to 1:1 DMs between two humans. Slack's API does not support this without per-user workflow automation, and the friction of setup is not worth it. The bot-as-intermediary model (DM the bot, or @mention it) is the clean path and requires no per-user plumbing.

### Presence-aware toggle

The ambassador can be active or dormant. Control modes, roughly in order of preference:

- **Explicit toggle** in Braintunnel settings (or Slack App Home) — cleanest, always works
- **macOS idle detection** via the desktop app ([IDEA-local-bridge-agent](IDEA-local-bridge-agent.md)) — auto-enable after N minutes of idle, auto-disable when active; this removes the "I forgot to turn it off" problem
- **Scheduled hours** — "auto-enable outside 9–6 Mon–Fri" as a fallback for those without the desktop app

Slack's modern Events API has no presence webhooks (the RTM API that supported `presence_sub` is deprecated as of 2025). Polling `users.getPresence` at low frequency is available as a weak signal but explicit toggle is the primary path.

When the ambassador activates, Braintunnel calls the Slack user status API to set the `🧠 Braintunnel active` status (and clears it when deactivated).

### Custom status as routing hint (AFK / busy)

What if the user's Slack **custom status text** (not only emoji) doubled as a CTA when they're away or busy — e.g. *"Ask @Braintunnel for an immediate answer on API migration / Q4 OKRs"* — so anyone who opens their profile or sees the status in a sidebar knows where to go for the answer they'd otherwise ping for?

This is lighter than intercepting human-to-human DMs (still out of scope): the human Slack thread stays untouched; Braintunnel only **advertises** the bot path on the user's own presence surface. Natural pairings:

- **Away-only / scheduled ambassador** — status text updates when the ambassador turns on; clears when off.
- **Manual busy** — user sets Slack to busy; optional Braintunnel setting: "when I'm busy in Slack, suggest @Braintunnel in my status" (sync or template the user can edit).
- **Copy templates** — short, user-editable defaults (*"Heads down — ask @Braintunnel in DM or #channel"*) with optional topic hint from recent wiki gaps or calendar (e.g. "on PTO through Friday").

**Open product question — autoresponse vs forward:**


| Path                | Behavior                                                                          | Pros                                              | Cons                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Status CTA only** | Status points to @Braintunnel; colleague must DM or @mention the bot              | No DM plumbing; matches bot-as-intermediary model | Colleague may still DM the human out of habit                                                                    |
| **Autoresponse**    | Slack auto-reply (or bot) on DM to the human: "Sarah's away — ask @Braintunnel …" | Catches habitual DMs                              | Slack auto-reply is user-configured or limited; easy to feel spammy; not true "forward" into ambassador pipeline |
| **Forward**         | Incoming DM to human triggers ambassador draft / notification                     | Highest capture rate                              | Requires capabilities Slack does not expose cleanly for third-party apps on 1:1 human DMs; blurs trust boundary  |


**Working hypothesis:** Status CTA + ambassador on the **bot** surfaces (DM `@Braintunnel`, channel @mention) is the default; treat **autoresponse** as an optional Slack-native snippet the user pastes into Slack's "When in a meeting / away" auto-reply (Braintunnel supplies copy, does not send on the user's behalf). **Forward** of human DMs remains out of scope unless Slack ships a supported delegation hook.

Worth validating in user research: whether status-only is enough, or whether teams expect an automatic first reply when they DM the absent person.

---

## Policy system

There are three layers of policy, forming a strict hierarchy: each lower layer can make behavior *more* restrictive than the one above it, never less.

### Layer 1 — Integration-scoped policy (the context floor)

Each Slack workspace installation has its own **integration policy** — a policy record attached to that specific connection, not to any individual user. This is the right level to answer questions like: "This Slack workspace is for Acme Corp's engineering team — the Braintunnel bot should only answer questions relevant to Acme's projects and mission, and should decline personal questions."

Integration policy is configured by the Braintunnel account holder who installed the app (the workspace anchor user). It reuses the same policy mechanism already in Braintunnel's core — it is simply a policy record scoped to a connection rather than a person. No Slack-specific policy code is needed; the platform-agnostic `PolicyEvaluator` applies it at evaluation time the same way it applies any other policy.

This pattern generalizes cleanly: a future Teams workspace installation would have its own integration policy on the same mechanism. The abstraction is "a policy assigned to an integration context," not "a Slack policy."

Examples of integration policy:

- "Constrain all answers to topics relevant to this organization's mission and active projects"
- "Do not answer personal questions (finance, health, relationships) regardless of what individual users have configured"
- "All responses require user approval before sending"
- "Never surface raw email content"

### Layer 2 — User default policy

Each enrolled user's general settings for their own ambassador. Operates entirely within the space the integration policy allows.

- Mode: `off` / `always` / `away-only` / `scheduled`
- Response style: concise / full context / triage-only (just ping me)
- Auto-send vs. always-review (when integration policy permits auto-send)
- Out-of-scope handling: "If you can't answer from the wiki, say so and offer to flag me"
- Data sources permitted: wiki only / wiki + filtered email

Where possible, this reuses existing Braintunnel policy infrastructure rather than inventing Slack-specific settings. A small amount of integration-specific configuration is appropriate (enough to cover the "what topics are relevant to this workspace" use case), but the goal is to extend existing patterns rather than build parallel ones.

### Layer 3 — Per-contact overrides

User-defined rules keyed to a specific Slack user ID or email. Can make behavior more restrictive for some contacts (e.g. unknown senders: triage-only, no details) or more permissive for trusted ones (e.g. a close colleague: full wiki context, auto-send allowed).

- Override mode (e.g. "for my manager: always-on")
- Override style (e.g. "for cold/unknown senders: triage-only, reveal nothing")
- Trust level: auto-send / always-review (within what integration policy and user default permit)

### Where configuration lives

**Integration policy** → Braintunnel settings → Connections / Slack workspace section (anchor user).  
**User policy + per-contact** → Braintunnel settings → Slack section (each user).  

Slack App Home surfaces a read-only status view and a single "Configure in Braintunnel →" deep link. Braintunnel is the canonical source of truth for all policy; no policy state lives in Slack.

---

## Context-scoped disclosure

Beyond the three policy layers, every response must also account for **where** it's being sent. The venue is a hard constraint that sits above even admin policy — you cannot override it by user preference because the ambassador has no control over who else can see a public channel.

**Effective disclosure = most restrictive of: admin policy × user policy × per-contact policy × venue**

### Venue tiers

**Public channel** — most restrictive, no exceptions.  
The ambassador does not know who will read the response (channel membership can include guests, future members, Slack Connect partners). Default: wiki-only content, no email-derived inferences, no relational specifics. If the question cannot be answered at this level, the ambassador declines and suggests DM-ing directly.

**Private channel** — marginally less restrictive.  
Membership is bounded. The Slack API can return the member list, which the ambassador can check against enrolled/known users. Slightly more context may be appropriate, but still conservative — channel membership changes without notice.

**DM to the Braintunnel bot (1:1)** — most permissive of the public surfaces.  
The ambassador knows exactly who is asking. This is where per-contact policy is meaningful: if the requester is an enrolled Braintunnel user with a grant, they can get deeper wiki context or policy-filtered email synthesis. If the requester is unknown, the "public stranger" baseline applies (same as public channel).

**Group DM** — treated as private channel: medium restrictive, check membership before answering.

### The key asymmetry

In a DM, the requester identity is known → per-contact policy is actionable → the response can be more useful.  
In a public channel, the audience is anonymous → per-contact policy is irrelevant → only the strictest baseline applies, no matter who sent the message.

This means the same question — "What does Alex think about the API migration?" — can get a meaningfully richer answer in a DM than in a public channel. That asymmetry should be surfaced to users clearly: "I can answer this in more detail if you DM me directly."

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

## Monorepo home

There is no reason this cannot live entirely within the existing brain-app monorepo, and good reasons to keep it there.

The Braintunnel server is a Hono/Node.js TypeScript application. Slack's Bolt SDK (Node.js) can run as HTTP middleware alongside Hono, with event handlers registered at `src/server/routes/slack.ts` and utilities under `src/server/lib/slack/`. This is the same pattern as ripmail living in-process under `src/server/ripmail/`. The Slack integration shares all existing infrastructure directly — wiki search, email search, agent pipeline, policy engine, B2B tunnel code — without any network hops or separate service.

**Dev setup consideration:** Slack's Events API requires a public HTTPS endpoint to deliver webhooks. Local development will need a tunnel (ngrok or similar). A `pnpm run dev:slack` convenience script that starts both the dev server and a tunnel would streamline this.

**When to extract:** Only if the adapter grows large enough to warrant its own package under a `packages/` workspace. For Phase 1, in-process is simpler and faster to iterate on.

---

## Multi-platform architecture

Slack is the first messaging platform; Microsoft Teams is the natural next one (enterprise footprint, Adaptive Cards are structurally analogous to Block Kit). The right architecture ensures adding Teams — or future adapters (Telegram, WhatsApp Business, etc.) — is incremental rather than a rewrite.

### The abstraction

A **platform-agnostic messaging core** (`src/server/lib/messaging/`) owns all business logic. Platform adapters are pure I/O translation layers with no business logic of their own.

**Core types and services (platform-agnostic):**

```
MessagingQuery       — who asked, who was addressed, venue type, content
MessagingVenue       — 'dm' | 'private_group' | 'public_channel'
PolicyEvaluator      — (query, venue, requester, target) → PolicyResult
AmbassadorAgent      — runs wiki/email search and draft synthesis within PolicyResult constraints
ApprovalRequest      — pending-approval record stored in brain-tenant.sqlite
```

**Platform adapter interface:**

```
resolveUserIdentity(platformUserId: string): Promise<string | null>  // → email
handleEvent(rawEvent: unknown): Promise<MessagingQuery | null>
sendResponse(channelId: string, text: string, attribution: string): Promise<void>
sendApprovalRequest(userId: string, draft: ApprovalRequest): Promise<void>
handleInteraction(rawInteraction: unknown): Promise<ApprovalDecision>  // button/modal response
```

**Slack adapter** (`src/server/lib/messaging/adapters/slack.ts`): Bolt integration. Translates Slack Events → `MessagingQuery`; `ApprovalRequest` → Block Kit with Send/Edit/Decline buttons; Block Kit interactions → `ApprovalDecision`.

**Teams adapter** (`src/server/lib/messaging/adapters/teams.ts`, future): Bot Framework / Azure Bot Service integration. Translates Teams Activity events → `MessagingQuery`; `ApprovalRequest` → Adaptive Cards with action buttons; Adaptive Card submissions → `ApprovalDecision`. User identity resolved via Microsoft Graph API (`/users/{id}` → UPN/email).

### What never changes across platforms

The policy evaluation, agent execution (wiki/email search, LLM synthesis, privacy filter), approval lifecycle, notification/brief queue entries, and wiki feedback loop are all in the platform-agnostic core. Adding Teams is: write the adapter, register it, test the identity resolution and message format. No changes to the agent or policy engine.

### Teams-specific notes

Teams uses the Azure Bot Service for event delivery (no ngrok needed in dev — uses ngrok or Azure Dev Tunnels). App manifests go in the Teams Developer Portal for distribution. Adaptive Cards support the same button → modal → submit pattern as Block Kit, so the approval UX maps cleanly. Microsoft Graph API's organization directory makes user identity resolution (Slack user → email → Braintunnel account) potentially more reliable in enterprise deployments than Slack's workspace-scoped user list.

---

## Acquisition flywheel

The non-Braintunnel user who receives a well-crafted Slack reply from their colleague's ambassador and sees the attribution footer is the highest-quality lead in the product's funnel: they've seen the product work, on a real use case, for someone they know. The "Get your own →" link in every footer is a warm, contextual CTA.

At team scale: if 20% of a Slack workspace enrolls Braintunnel and their ambassadors handle dozens of interactions a week, the remaining 80% are repeatedly exposed to the product. Unlike most B2B products, the value to non-users is *immediately visible* — they just got a useful answer.

This also provides a path into B2B sales: a champion at a company activates Braintunnel → their teammates see it → a team or org deal emerges organically.

---

## Phased breakdown (for future OPPs)

**Spike (shipped — [archived OPP-116](../opportunities/archive/OPP-116-slack-hello-world-app.md)):** hello world bot only (dev). Staging verification deferred.

**Foundation ([OPP-117](../opportunities/OPP-117-slack-identity-and-messaging-adapter.md)):** workspace install + user link, `MessagingQuery` + Slack adapter (hello-world behavior only).

When ready to implement product phases after OPP-117, this idea should be sliced into roughly these phases:

**Phase 1 — Bot + explicit toggle + default policy + DM only + messaging core**

- Team install, per-user OAuth, Slack status sync
- Explicit "ambassador on/off" toggle in Braintunnel settings
- Default policy only (no per-contact overrides, no admin policy UI yet)
- DM-to-bot only (no channel presence)
- Full approval flow in Slack (Block Kit approve/edit/decline)
- Brain Hub "Slack handled" card (basic, list only)
- Attribution footer
- Platform-agnostic messaging core scaffolded (`MessagingQuery`, `PolicyEvaluator`, `AmbassadorAgent`, `ApprovalRequest`) — Slack adapter as first implementation

**Phase 2 — Policy hierarchy + channel presence + digest polish**

- Admin workspace policy (Layer 1): configuration UI in Braintunnel settings, enforcement in privacy filter
- Per-contact policy overrides (Layer 3): configuration UI in Braintunnel settings
- Bot invited to channels; context-scoped disclosure enforced by venue tier
- "DM me for more detail" nudge when channel policy limits the response
- Richer Brain Hub digest (conversation view, follow-up actions)
- Wiki gap detection from unanswerable questions

**Phase 3 — Presence-aware + wiki feedback loop + AgentExchange**

- Desktop idle detection → auto-enable/disable (via [IDEA-local-bridge-agent](IDEA-local-bridge-agent.md))
- Wiki feedback loop (mark good/bad answers, surface edit path)
- Scheduled hours mode
- AgentExchange listing (Slack's unified agent marketplace)

**Phase 4 — Teams adapter (and beyond)**

- Microsoft Teams adapter using the `MessagingAdapter` interface established in Phase 1
- Bot Framework / Azure Bot Service integration
- Adaptive Cards approval UX (structurally identical to Block Kit flow)
- Microsoft Graph API for identity resolution

---

## Decisions

**Bot identity:** Single shared Braintunnel bot for all replies, not per-user bots. Keeps the Slack app manifest simple and avoids distribution constraints.

**Auto-reply to human DMs:** Out of scope. Slack's API does not allow intercepting 1:1 human-to-human DMs without per-user Workflow Builder setup. Not worth the friction; the bot-as-intermediary model is the clean path.

**Policy enforcement architecture:** Reuse existing Braintunnel policy infrastructure. Integration-scoped policy (Layer 1) is a policy record attached to the connection — not Slack-specific code. The `PolicyEvaluator` applies it the same way it applies any policy. A small amount of integration-specific configuration (topic constraints, data source limits) is appropriate at the connection level; the goal is to extend existing patterns.

**Prerequisite for workspace install:** The Slack workspace admin must have a Braintunnel account. No anonymous installs.

**Venue policy for private channels:** Simplest option for Phase 1 — treat private channels the same as public channels (maximum restrictiveness). Channel membership checks add latency and API scope; add finer-grained venue tiers only if the market asks.

**Multi-workspace:** Architecture must support a single Braintunnel account connected to multiple Slack workspaces. Each workspace is a separate connection with its own integration policy. Not a constraint.

**Latency UX:** Needs design attention. The goal is never leaving the user staring at silence. Posting an immediate "Thinking…" acknowledgment and updating in-place (`chat.update`) is the likely answer for Slack. How Slack's API rate limits interact with streaming-style updates needs validation when implementation starts. This may not be Phase 1 but should be planned for, not retrofitted.

**Microsoft Teams:** Lower priority, later effort. The platform-agnostic messaging core established in Phase 1 makes it an incremental adapter — no duplicate policy logic, no agent changes. Build it when the opportunity is clear, not as infrastructure speculation.

**AgentExchange:** Not a near-term priority. Standard Slack App Marketplace listing is the distribution target.