# OPP-002: Public Brain Identity

**Related:** [OPP-001: Agent-to-Agent Communication](./OPP-001-agent-to-agent.md) — OPP-001 covers private bilateral channels between connected brains. This doc covers the public-facing layer: your brain as a discoverable, interactive identity on the web.

## The idea

Today, your online identity is fragmented across a dozen static profiles — LinkedIn, personal website, Twitter bio, GitHub README — none of which can actually *do* anything. They're posters on a wall. Someone who wants to reach you, learn about you, or collaborate with you has to read your profiles, compose an email, and wait. The profiles themselves are inert.

What if your brain *was* your web presence? Not a static page, but a live agent that represents you publicly — answering questions, triaging inbound requests, facilitating introductions, and serving as the front door to everything you're willing to share. A public identity that's as smart as your private assistant.

The key distinction from OPP-001: that doc describes what happens *after* two brains trust each other. This doc is about what happens *before* — how brains are discovered, how strangers interact with them, and how your brain represents you to the world.

---

## Tiered access model

The core design principle: your brain exposes different capabilities to different audiences, with the user always in control of what each tier can see and do.

### Tier 0: Public (anonymous)

Anyone on the web can interact with your brain's public interface. This is radically restricted — think of it as your personal website, except it can hold a conversation.

What's exposed:
- Public bio and professional summary (curated from wiki)
- Areas of interest and expertise
- How to reach you / request a connection
- Answers to questions you've explicitly marked as public

What's *not* exposed: calendar, email, private wiki, anything about your personal life. The brain politely declines out-of-scope questions.

This tier is essentially a conversational `robots.txt` — your brain decides what's indexable and what isn't, and it can engage with the question rather than just serving flat text.

### Tier 1: Verified (email-identified)

A visitor who identifies themselves via email gets slightly more. The brain can verify their address (challenge email, OAuth, signed token) and now knows *who* it's talking to.

What's unlocked:
- Request a connection (triggers OPP-001 handshake)
- Ask your brain to relay a message to you (brain triages)
- Query availability at a high level ("Is Lew open to coffee chats?")
- Context-aware responses (your brain checks its wiki — "Oh, this person works at the same company as someone I know")

This is the "knocking on the door" tier. Your brain is the receptionist.

### Tier 2: Connected (OPP-001)

Full bilateral trust channel with scoped permissions, as described in OPP-001. This tier is the result of a successful handshake — two brains that have explicitly agreed to communicate.

### Why tiers matter

Without a public tier, the only way to connect brains is manual: "connect with Sterling." That requires you to already know Sterling and have his contact info. The public tier makes brains *discoverable* — you can find a brain you've never encountered before, learn something about the person behind it, and request a connection. The tiers are a funnel: public discovery leads to verified contact leads to private collaboration.

---

## Your brain as receptionist

The most immediately practical use case: your brain triages inbound communication so you don't have to.

### The problem today

Public-facing people (founders, open-source maintainers, anyone with a visible email) drown in inbound messages. Cold emails, recruiter spam, genuine collaboration requests, fan mail, sales pitches — all dumped into the same inbox. Most goes unanswered because triaging is exhausting.

### How the brain fixes it

Your brain's public interface becomes the front door. Instead of emailing you directly, people talk to your brain first:

- **"I'd like to discuss a potential investment."** Brain checks wiki for context on the sender (do you know them? do they work somewhere relevant?), categorizes as high-priority, and surfaces it with context: "Investment inquiry from Jane at Sequoia — you met her at the YC dinner last March."
- **"Can I pick your brain about Kubernetes?"** Brain checks your public availability preferences. If you've marked yourself as open to technical conversations, it offers to schedule or suggests reading your public wiki pages on the topic first.
- **"We have an exciting opportunity at..."** Brain recognizes recruiter patterns, logs it, doesn't bother you.
- **"I'm a student working on a project similar to yours."** Brain responds warmly with relevant public resources, offers to relay a message if the student has a specific question you'd need to answer personally.

The user reviews a digest of what their brain handled, approves or overrides decisions, and the brain learns their preferences over time. The brain becomes the spam filter, executive assistant, and public relations agent rolled into one.

---

## Web presence

### The conversational homepage

Your brain's public tier is accessible via a URL — `brain.lewcirne.com` or `lewcirne.com/brain` or whatever convention emerges. Visitors land on a chat interface (or a structured page with a chat option) and can interact with your public-facing agent.

This replaces (or augments) the personal website. Instead of a static "About" page that you update once a year, your brain dynamically answers questions from your current wiki state. Your expertise, interests, and availability are always current because they're drawn from the same knowledge base your private agent maintains.

### Structured data for machines

The public tier also serves structured metadata for automated discovery:

- **WebFinger / `.well-known`:** Standard endpoint so other brains (and tools) can discover your brain's capabilities from your email address or domain.
- **Capability manifest:** Machine-readable declaration of what your public brain exposes — supported query types, connection protocol version, public key.
- **Schema.org / JSON-LD:** Structured data about you (name, role, expertise areas) that search engines and other agents can consume.

This means your brain is discoverable not just by humans browsing to your URL, but by other brains programmatically searching for relevant people.

---

## Automated discovery and network building

This is where the public identity layer becomes a growth engine.

### Domain-based discovery

Like email MX records or DKIM, a DNS convention for brain endpoints:

```
_brain.lewcirne.com.  TXT  "v=brain1; endpoint=https://brain.lewcirne.com; key=..."
```

Any brain that knows your domain can discover your brain's endpoint automatically. Combined with WebFinger (discover from email address) and `.well-known` (discover from any URL on your domain), there are multiple paths to finding a brain from minimal starting information.

### Public directories (opt-in)

An opt-in directory where brains register themselves with tags — interests, expertise, location, availability for various types of interaction. Think of it as a yellow pages for brains, except the listings are live agents.

- "Find brains interested in distributed systems in San Francisco"
- "Find brains that accept open-source collaboration requests"
- "Find brains whose users work in biotech"

Critical: opt-in only, user-controlled tags, no scraping. The directory is a public service, not a surveillance tool.

### Agent-initiated discovery

Your brain can proactively find relevant brains on your behalf:

- **From your contacts.** Your brain scans your email contacts and wiki people pages, checks for brain endpoints (via WebFinger/DNS), and suggests connections: "Sterling has a brain. Want to connect?"
- **From shared interests.** Your brain queries public directories for people with overlapping expertise and suggests introductions.
- **From the network.** Connected brains (OPP-001) can broker introductions: "Alex's brain says you'd get along with Jordan — similar interests in ML infrastructure. Want me to reach out?"

The user always approves. The brain discovers; the human decides.

### Conference / event mode

A temporary, location-aware discovery mode: "I'm at Strange Loop. Make my brain discoverable to other attendees." Your brain registers in an event-scoped directory, other attendees' brains can see your public profile, and connection requests flow naturally. After the event, the discovery scope closes, but any connections you made persist.

This replaces the business card. You meet someone, say "my brain is `lewcirne.com`," and their brain handles the rest — finds your endpoint, reads your public profile, initiates a connection request, and by the time you're both home, both wikis have a page about the new contact with context from the conversation and the event.

---

## Implications for the product

### Identity becomes the product

In the single-user brain, identity is an implementation detail — you're the only user, who cares. In a networked brain, your identity *is* the product. Your brain's public face is how the world interacts with you digitally. This shifts brain-app from "personal productivity tool" to "personal digital identity platform" — a much larger market and a much deeper moat.

### The anti-LinkedIn

LinkedIn works because there's no alternative for professional identity. But LinkedIn is broken in well-understood ways: performative engagement, algorithmic feeds, pay-to-play messaging, profiles that are résumés rather than representations of what someone actually knows and cares about.

A brain-based professional identity is:
- **Honest.** Your brain represents your actual knowledge (wiki), not a curated highlight reel.
- **Interactive.** People can ask questions, not just read bullet points.
- **Private by default.** You share what you choose. No data mining, no ad targeting.
- **Agent-mediated.** Your brain handles the social overhead (triaging, scheduling, follow-ups) that makes LinkedIn networking exhausting.

You don't replace LinkedIn by building a better LinkedIn. You replace it by making professional identity a byproduct of the tool people already use to manage their lives.

### Revenue model implications

The public tier creates natural monetization that doesn't exist in a single-user tool:

- **Premium identity features.** Custom domain, verified identity, priority in discovery directories.
- **Inbound management.** Advanced triage rules, analytics on who's trying to reach you, auto-response customization.
- **Network features.** Introduction brokering, expertise matching, event discovery.

These are features people (especially professionals, founders, public figures) would pay for — and they only exist because the brain has a public face.

---

## Security and abuse considerations

A public brain interface opens attack surfaces that a private tool doesn't have.

### Abuse vectors

- **Denial of service.** Flood a brain's public endpoint with queries. Mitigation: rate limiting, proof-of-work challenges for anonymous queries, CDN/edge protection.
- **Social engineering.** Craft queries to manipulate the brain into revealing private information through its public interface. Mitigation: the public tier has a hard boundary — it can only access explicitly public data, not the private wiki or email. The boundary is architectural, not prompt-based.
- **Scraping.** Automated extraction of public profile data at scale. Mitigation: rate limiting, bot detection, the fact that conversational interfaces are harder to scrape than structured pages.
- **Impersonation.** Someone stands up a brain claiming to be you. Mitigation: domain verification (DNS-based discovery ties brain to domain ownership), email verification, optional identity attestation.
- **Harassment.** Unwanted repeated contact through the public interface. Mitigation: block lists, pattern detection, the brain itself can recognize and refuse abusive interactions.

### The hard boundary between public and private

The most critical architectural decision: the public tier must be a *separate context* from the private brain. It cannot be the same agent with a "be careful what you share" instruction. It must be architecturally incapable of accessing private data.

Implementation options:
- Separate agent instance with read access only to explicitly public wiki pages and a public-only system prompt.
- A proxy layer that intercepts all data access and enforces the public permission scope before anything reaches the agent.
- A dedicated "public brain" that syncs a curated subset of the private wiki and has no access to email, calendar, or private pages.

The right answer is probably the third — a separate agent with its own data store, synced from the private brain under user-controlled rules. Defense in depth: even if the public agent is compromised, there's no path to private data because the data doesn't exist in its context.

---

## Relationship to OPP-001

These two ideas form a natural stack:

| Layer | OPP-001 | OPP-002 |
|---|---|---|
| Audience | Known, trusted contacts | Anyone (tiered) |
| Discovery | Manual ("connect with Sterling") | Automated (DNS, WebFinger, directories) |
| Permission model | Bilateral, scoped, negotiated | Unilateral, tier-based, user-defined |
| Data exposure | Private data within agreed scope | Public data only (hard boundary) |
| Initiation | Explicit handshake | Open endpoint |
| Relationship | Persistent, stateful | Ephemeral (until escalated to OPP-001) |

The flow: OPP-002 is how brains find each other. OPP-001 is what happens after they decide to trust each other. Public identity is the top of the funnel; bilateral trust is the bottom.

---

## Sequencing

1. **After OPP-001 basics exist.** Public identity only makes sense if there's a private channel to graduate into. Build bilateral connections first.
2. **Start with structured public profile.** Before conversational public interface, ship a simple structured endpoint (JSON, `.well-known`) that declares "this person has a brain at this URL." No chat, just discovery.
3. **Add read-only public chat.** Let anonymous visitors ask questions answered from explicitly public wiki content. Very restricted, heavily rate-limited. Learn what people actually ask.
4. **Add verified tier.** Email verification, connection request flow, message relay. This is where the receptionist use case comes alive.
5. **Add automated discovery.** DNS records, WebFinger, opt-in directories. This is where network growth becomes self-sustaining.
6. **Event/context-aware discovery.** Conference mode, location-based, interest-based. This is where it gets fun.
