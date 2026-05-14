# Brain Cloud Service — Architectural Notes

**Status:** Pre-opportunity. Not yet scoped for implementation. These are architectural thoughts on what a centrally operated service — run by us — might eventually look like, and what it absolutely must not be.

**Related:** **[Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md)** (brain-to-brain vision, sequencing, security model), **[brain-to-brain-access-policy](./brain-to-brain-access-policy.md)** (draft policy layers for grants and tools), [archived OPP-008](../opportunities/archive/OPP-008-tunnel-qr-phone-access.md) (tunnels), [OPP-030](../opportunities/archive/OPP-030-agent-driven-support-bug-to-pr.md) (support/bug pipeline).

---

## The core idea

Right now each brain is entirely self-contained. There is no central place on the internet that knows Brain exists, let alone that *your* brain exists. That's fine for the local-first personal-tool phase, but at some point there are things we'd want to run centrally — not to hold user data, but to provide the lightweight coordination layer that makes a local-first network actually work.

The service we'd run is small, stateless with respect to user content, and entirely opt-in. Its job is to be the address book and post office for the network — not the content, not the keys, not the email, not the wiki.

---

## What would live there

### 1. Brain Registry

A registry is the minimum viable "internet presence" for a brain. A brain opts in and receives an anonymous identifier — an opaque ID, not tied to a real name, email address, or any personal information. The brain holds the key; we hold the ID.

What the registry enables:

- **Discovery and connection.** Two brains that want to communicate need a rendezvous point. The registry provides a stable, publicly reachable endpoint for each registered brain (and can back **Braintunnel-style handles**), without revealing who owns it. This is the infrastructure layer beneath [Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md)'s bilateral trust channels and public-identity tier.
- **Public presence.** Longer-term, a registered brain can publish materials — a public profile, areas of expertise, availability signals — creating a presence on the internet without centralizing any private data. The content is chosen and pushed by the brain; the registry just serves it.
- **Contact via your assistant.** Eventually, the way to get in touch with you is to reach your brain. The registry is how strangers find it. This is the top of the funnel described in the deferred public-brain-identity section of [Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md): the registry gives your brain a stable internet address.
- **Opt-in only, anonymous by default.** No registration required to use Brain. If you register, you get an anonymous ID and control over what (if anything) that ID publishes. Nothing about who you are is stored or inferrable from the ID alone.

### 2. Support and Bug Infrastructure

The natural home for the bug-filing pipeline described in [OPP-030](../opportunities/archive/OPP-030-agent-driven-support-bug-to-pr.md). Moving it to a cloud endpoint owned by us:

- **Registry-linked bug reports.** A brain that files a bug can attach its anonymous registry ID. This lets us associate multiple reports from the same brain over time without knowing who owns it — useful for follow-ups, deduplication, and notifying the reporter when a fix ships.
- **Brain notifications on fix.** When a bug tied to a registry ID is resolved, the service can notify the registered brain: "Your report #123 is fixed in 0.4.3." The brain delivers this to the user in-app. No email address required.
- **Aggregates and signals.** With a registry, we can compute things we can't compute today: how many distinct brains hit a given error, which versions are most common in the wild, which bugs are correlated. All of this is aggregate and anonymous — no individual brain's content is involved.
- **Agent-based triage.** Bug reports arrive structured (per OPP-030's submission format) and are processed by agents on our side: deduplication, labeling, routing, draft PRs. The registry ID is the thread that ties a report to a brain, not a person.

### 3. Tunnel Coordination

For features like [archived OPP-008](../opportunities/archive/OPP-008-tunnel-qr-phone-access.md) (phone access via QR / tunnel) and the brain-to-brain direct channels in [Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md), there may be infrastructure we need to run centrally for NAT traversal and tunnel setup — especially when both brains are behind NAT and can't reach each other directly.

A TURN/signaling relay or a Cloudflare-style tunnel coordinator would live here. The key constraint is that this infrastructure routes *connections*, not *content*. It helps two endpoints find each other; it does not read, store, or process the payload. The content stays end-to-end encrypted between the brains.

---

## The hard constraint: no user data

This is the principle that constrains everything above.

**What stays local, always:**
- The wiki. All pages, notes, and personal knowledge.
- Email and calendar data.
- API keys (LLM providers, OAuth tokens, everything).
- The agent's system prompt and memory.
- Any files, attachments, or documents.

**What the cloud service may hold:**
- Anonymous registry IDs and their associated public endpoints.
- Opted-in public profile content — chosen and pushed by the brain, revocable.
- Bug report payloads (structured, redacted, per-report consent per OPP-030's model).
- Aggregate signals derived from reports (version counts, error rates).
- Routing state for active tunnel sessions (ephemeral, not stored after session ends).

If we ever find ourselves designing a feature that requires the cloud service to hold user content in order to work, that's a signal to reconsider the design — not to relax the constraint.

---

## What else might live here eventually

These are not even sketched out yet, but worth naming so they're not forgotten:

- **Version/update distribution.** A stable endpoint for [archived OPP-029](../opportunities/archive/OPP-029-auto-update.md) update manifests and signed artifact downloads. We'd run this rather than depend on GitHub Releases alone.
- **Brain-to-brain relay (ephemeral).** During the initial handshake (see [Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md) M1), before two brains have established a direct channel, a central relay might broker the initial exchange. After the channel is set up, the relay is no longer involved.
- **Public directory (opt-in).** An indexed, searchable listing of brains that have chosen to be discoverable — tagged by interests, expertise, availability. Described in the deferred public-brain-identity section of [Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md). No private data; only what each brain explicitly publishes.

---

## What this is not

- A multi-tenant SaaS where user data lives in our cloud. The brain is always local.
- A required dependency. A brain with no registry ID should still work fully for everything that doesn't involve the network.
- An authentication or identity service in the traditional sense. We don't know who you are; we just know your brain has a key that corresponds to a registered ID.
- A surveillance or telemetry system. Aggregate signals are opt-in and purpose-limited to improving the product.

---

## Open questions (for when this becomes an opportunity)

- **ID scheme.** Anonymous opaque ID vs. a keypair-based DID (decentralized identifier)? The latter is more self-sovereign but more complex to implement and explain.
- **Hosting.** Cloudflare Workers (edge, low-latency, cheap) vs. a traditional server? Given the stateless nature of most operations here, edge is attractive.
- **Abuse.** Rate limiting on registry registration, spam registration, fake bug reports. What's the floor of friction before registration that doesn't compromise privacy?
- **Revocation.** If a brain's key is compromised, how does it recover its registry ID? Key rotation mechanics.
- **Relationship to federation.** Is the registry a temporary bootstrap toward a fully federated system (like email's MX records), or is there value in a single authoritative registry long-term?
