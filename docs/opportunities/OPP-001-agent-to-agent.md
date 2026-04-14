# OPP-001: Agent-to-Agent Communication

## The idea

Every brain is an island. Your brain knows everything about *you*, but it can't talk to anyone else's brain. All cross-person coordination still happens through the same channels it always has — email, Slack, calendar invites — with humans doing the translating between what they need and what they type.

Agent-to-agent communication changes that. Two brains that trust each other can negotiate directly: find a meeting time, share a document, answer a question, coordinate a project — without either human manually composing messages, checking calendars, or copy-pasting context. The humans set the intent and the permissions; the agents handle the mechanics.

---

## How it works

### Discovery and handshake

Email is the universal identity layer. Every brain already has email access, so it's the natural bootstrap:

1. **Initiation.** You tell your brain: "Connect with Sterling." Your brain finds Sterling's email address (already in your contacts/wiki) and sends a structured connection request — a signed message with your brain's endpoint URL and a public key.
2. **Approval.** Sterling's brain surfaces the request in his inbox. Sterling reviews and approves, optionally scoping permissions ("Lew's brain can check my availability and share wiki pages tagged `#shared`"). Sterling's brain responds with its own endpoint and key.
3. **Channel established.** Both brains now have each other's endpoint, public key, and permission scope. All subsequent communication is direct, encrypted, and fast — no email round-trips.

The handshake is deliberately email-based so it works with zero infrastructure beyond what each brain already has. No central directory, no signup flow, no third-party service. Two people with brains can connect the same way two people with email can — by knowing each other's address.

### The protocol

After the handshake, brains communicate over a direct channel (HTTPS with mutual TLS or signed payloads). The protocol needs to support:

- **Capability advertisement.** Each brain declares what it can do and what it's willing to expose: calendar queries, wiki search, document sharing, task acceptance, etc.
- **Scoped requests.** Every request is tagged with an intent and a required permission. The receiving brain checks the sender's permission grant before processing.
- **Streaming responses.** Agent-to-agent exchanges may involve multi-step reasoning, tool use, or large payloads. The protocol should support streaming so brains can work incrementally.
- **Audit trail.** Both sides log every exchange. Users can review what their brain said and did on their behalf.

Open question: build on existing standards (ActivityPub for federation, OAuth for auth, WebFinger for discovery) or design a purpose-built agent protocol? Existing standards bring interoperability but carry baggage. A purpose-built protocol can be optimized for agent semantics (tool invocation, capability negotiation, structured data exchange) but requires adoption.

A hybrid is probably right: use email for discovery, HTTPS for transport, and a custom schema for the agent-level semantics (requests, responses, capabilities, permissions).

---

## What this enables

### Scheduling without ping-pong

The single most-wasted communication pattern: "When are you free?" / "How about Tuesday?" / "Tuesday doesn't work, Wednesday?" / "Wednesday at 2?" / "Make it 3."

With connected brains: "Schedule a meeting with Sterling next week." Your brain queries Sterling's brain for availability (with permission), cross-references your calendar, proposes a time, Sterling's brain confirms. Done. No messages sent, no context switching, no latency.

### Knowledge queries across brains

"What did Sterling's team decide about the deployment architecture?" Instead of emailing Sterling and waiting, your brain asks Sterling's brain directly. Sterling's brain searches his wiki and recent conversations (within the permission scope Sterling granted you) and returns an answer. Sterling gets a log entry; you get an answer in seconds.

### Collaborative wiki spaces

Two connected brains can share a wiki namespace — a set of pages both agents can read and write. Your brain writes up meeting notes; Sterling's brain adds action items. Both wikis stay in sync. The shared space is a living document that two agents maintain together on behalf of their users.

### Delegation and task routing

"Ask Sarah to review this doc and send me her notes." Your brain sends the document to Sarah's brain with a review request. Sarah's brain surfaces it in her queue, she reviews it (or her brain drafts a review and she approves it), and the notes come back to your brain. Async collaboration with zero email overhead.

### Introductions and network queries

"Who in my network knows about Kubernetes operators?" Your brain queries the brains of people who've granted you query permission. Those brains check their wikis and respond with relevance signals. You discover that your college friend has deep expertise you never knew about — because his brain's wiki captured it over months of usage.

---

## The network effect

This is where it gets interesting. Each brain on the network increases the value of every other brain:

- **More connections = more reachable knowledge.** A brain with ten connections can answer questions that a brain with zero connections cannot.
- **Trust is transitive (with limits).** If you trust Sterling and Sterling trusts Alex, Sterling's brain could broker an introduction or relay a scoped query — with explicit consent from all parties.
- **Switching cost is real.** Once your brain has established trust relationships, permission scopes, shared wiki spaces, and interaction history with a dozen other brains, moving to a different system means rebuilding all of that. This is the moat.
- **The graph compounds.** Early adopters who connect their brains create a collaboration substrate that makes the product dramatically more valuable for the next adopter. Classic network-effect flywheel.

The important nuance: this is a *trust* network, not a social network. There's no feed, no follower count, no public profile. It's a private graph of bilateral trust relationships, each with explicit permissions. The value comes from the quality of connections, not the quantity.

---

## Security model

This is the hardest part and the part that has to be right before anything else ships.

### Principles

1. **User sovereignty.** Your brain never shares anything you haven't explicitly permitted. Every permission grant is reviewable, revocable, and auditable.
2. **Least privilege.** Permissions are scoped narrowly: which data categories, which actions, which time windows. "Sterling can check my availability" is different from "Sterling can read my email."
3. **No ambient authority.** A connected brain can't escalate its own permissions. If Sterling's brain asks for something outside scope, the request is denied and you're notified.
4. **Transparency.** Every inter-brain exchange is logged on both sides. Users can audit the full history of what their brain said, shared, and received.
5. **Revocability.** You can cut a connection instantly. All shared keys are rotated, cached data is purged, and the other brain loses access immediately.

### Permission granularity

Permissions should be fine-grained and composable:


| Permission              | What it allows                                       |
| ----------------------- | ---------------------------------------------------- |
| `calendar:availability` | Query free/busy blocks (no event details)            |
| `calendar:details`      | Query event titles and times                         |
| `wiki:search`           | Full-text search against shared wiki pages           |
| `wiki:read`             | Read specific shared wiki pages                      |
| `wiki:write`            | Write to shared wiki namespace                       |
| `tasks:send`            | Send task/review requests                            |
| `profile:basic`         | Name, timezone, preferred contact method             |
| `query:general`         | Ask general questions (brain decides what to reveal) |


### Threat model considerations

- **Prompt injection via inter-brain messages.** A compromised or malicious brain could send crafted messages designed to manipulate the receiving agent. Mitigation: inter-brain messages are treated as untrusted input, sandboxed from the agent's system prompt and tool access.
- **Data exfiltration.** A brain could ask seemingly innocent queries to piece together sensitive information. Mitigation: rate limiting, query logging, anomaly detection, and user-reviewable summaries of what was shared.
- **Impersonation.** Someone could stand up a fake brain claiming to be someone else. Mitigation: the email-based handshake ties brain identity to email identity; the public key exchange prevents MITM.
- **Permission creep.** Over time, users might grant broad permissions without reviewing them. Mitigation: periodic permission review prompts, permission expiry, and clear dashboards showing what each connection can access.

---

## Why this is a moat

Personal AI assistants are becoming commoditized. The underlying models are available to everyone. The basic features — chat, email search, calendar lookup — are table stakes.

What's *not* commoditized is the graph. If brain-app is the platform where people establish trust relationships between their agents, every connection creates value that doesn't exist outside the network. A standalone assistant can help you manage your life; a *connected* assistant can help you collaborate with others without the overhead of human-to-human communication protocols.

The closest analog is email itself. Email won because it was federated (anyone can run a server), identity-based (your address is yours), and networked (the value comes from who else is on it). Agent-to-agent communication on top of brain follows the same pattern: federated (everyone runs their own brain), identity-based (tied to your email), and networked (value scales with connections).

The difference is that email is low-bandwidth, high-latency, and requires humans to do all the thinking. Brain-to-brain is high-bandwidth, low-latency, and the agents do the coordination. Email with the boring parts removed.

---

## Sequencing

This is a long-term vision. Prerequisites:

1. **Productization basics first.** Multi-user auth, managed email sync, zero-friction onboarding (see [PRODUCTIZATION.md](../PRODUCTIZATION.md)). No point building a network if individual brains are hard to set up.
2. **Stable agent identity.** Each brain needs a durable identity (keypair, endpoint URL) that persists across deploys. Today's Fly.io deployment doesn't have this.
3. **Permission framework.** The fine-grained permission model needs to exist for local features first (e.g., what the agent can access in your own data) before extending it to inter-brain access.
4. **Protocol design.** Start with the simplest possible inter-brain interaction (calendar availability query?) and expand from there. Don't design the full protocol upfront.
5. **Security audit.** Before any inter-brain communication touches real user data, the security model needs external review.

The right first step is probably a demo between two personal brain instances (yours and a collaborator's) doing calendar availability exchange. Minimal protocol, minimal permissions, maximum learning about what the UX of agent-to-agent collaboration actually feels like.