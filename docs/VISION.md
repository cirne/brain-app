# Vision

## What this is

A personalized assistant that magically knows everything about you — your people, projects, interests, travel, and history — and gets smarter over time. Not a generic chatbot you have to re-explain yourself to every session. A second brain: one that reads your email, watches your calendar, remembers what you told it, and builds a living knowledge base from your actual life.

The assistant is genuinely useful on day one (email search, calendar lookup, quick notes) and becomes indispensable over months as the wiki fills in. The magic is the compounding — every interaction either answers a question or adds something to the brain.

### Personal wiki (what we call it)

We use **wiki** on purpose: it is a familiar pattern—**linked text pages** (like the public sites built on the same idea), but **private and yours**. Braintunnel helps you **create and maintain** that wiki so it captures what matters; the assistant then **reads** it to stay personalized instead of generic. New users do not need prior wiki experience—[product copy and onboarding framing](product/personal-wiki.md) explain it in plain language.

---

## Inspiration

The product idea has **two conceptual halves** that we combine: (1) **LLM-maintained personal wiki** — a persistent, compounding markdown layer, not RAG re-discovery every session, and (2) **queryable personal mail** — [ripmail](../ripmail/README.md) (indexed email as rich ground truth). This doc is the outcome; the canonical statement of the wiki half is Andrej Karpathy’s **[LLM Wiki](karpathy-llm-wiki-post.md)** (full [gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)).

**Andrej Karpathy — LLM Wiki** — Karpathy’s pattern: raw sources, a **wiki** the LLM owns (ingest, query, lint), and a **schema** (`AGENTS.md`-style) that keeps the agent disciplined. The insight is that the value isn’t in any single note; it’s in **accumulation** (cross-references, contradictions flagged, synthesis kept current) and in **bookkeeping at scale** — the maintenance humans abandon. [Read the full post in our docs](karpathy-llm-wiki-post.md).

**ripmail** — Email is the richest personal data source most people have. It contains your relationships (who you talk to, about what, how often), your history (travel, purchases, projects), and signals about what matters to you. ripmail makes that data actually queryable. Combine a searchable email index with a growing wiki and you have the raw material for a genuinely personalized assistant.

The combination: a wiki that you (and the assistant) actively maintain, grounded by email and calendar data, queried through natural language. The Obsidian-style vault Karpathy describes, but productized: **wiki half + mail half.**

---

## The problem with generic LLM assistants

Claude Code and tools like it are powerful but generic. Every session starts cold. The model doesn't know who you are, who your colleagues are, what you're working on, or what happened last week. You spend half the conversation providing context that you've already provided a dozen times before.

Generic assistants are also error-prone precisely because they're generic — they fill in gaps with plausible-sounding guesses rather than facts from your actual life. A personalized assistant with access to your real data makes fewer mistakes and requires less hand-holding.

The number one use case people actually want from an LLM assistant is: *help me manage my life*. Not write code in the abstract, not explain concepts in a vacuum — help me with my specific emails, my specific calendar, my specific projects, my specific people. That use case demands personalization. Brain-app is what happens when you build for that use case from the start instead of bolting it on.

---

## What "magical" means

The bar is: a new user signs up, approves Google access, and within five minutes is having a conversation that feels like talking to someone who already knows them. The assistant:

- Knows who their frequent collaborators are (from email history)
- Knows what they've been working on (from recent email threads and calendar)
- Can find the email from three months ago about the thing they half-remember
- Can draft a reply in their voice
- Remembers things they've explicitly told it, in the wiki, and surfaces them later unprompted

No setup wizard. No configuration files. No explaining yourself. It just works, and it gets better the longer you use it.

---

## How we get there

**Short term (personal tool):** The current app — Hono + Svelte + pi-agent-core, personal deployment on Fly.io, manual wiki repo setup. Proves the core loop: chat is grounded in real data, wiki grows through use, email and calendar are queryable. This is the phase we're in.

**Medium term (productization):** Google OAuth replaces manual setup. Email sync starts automatically after consent. Wiki storage moves off git onto something zero-friction (S3-compatible). Calendar integration is OAuth-driven. A new user can be fully set up in minutes without touching a terminal. See [PRODUCTIZATION.md](./PRODUCTIZATION.md) for the blockers.

**Long term (the magic):** Automatic wiki scaffolding on signup — the assistant reads email history and bootstraps the wiki with pages for frequent contacts, ongoing projects, and recurring topics. Proactive suggestions: "you haven't followed up with X in a month," "you have a trip to Y coming up, want me to pull together your notes?" The wiki grows passively, not just when you explicitly ask it to.

---

## Brain-to-brain: where the value compounds

The single-user brain is useful from day one. But the strategic differentiator is what happens when brains connect.

Personal assistants commoditize. Models and basic tools do not differentiate. What compounds is the **graph**: bilateral trust relationships between brains, each with explicit scopes, audit history, and human-in-the-loop defaults where it matters.

The analog is not a social feed; it is a **trust network**. Value scales with who your brain may query on your behalf and what you permit — not with follower counts. Switching products means rebuilding that graph. That is the real switching cost once the network exists.

The closest analog is email itself. Email won because it was federated (anyone can run a server), identity-based (your address is yours), and networked (value scales with who else is on it). Brain-to-brain follows the same pattern: federated (everyone runs their own brain), identity-based (Braintunnel handle + key material, email as bootstrap), and networked (value scales with connections).

The difference: email is low-bandwidth, high-latency, and requires humans to do all the thinking. Brain-to-brain is high-bandwidth, low-latency, and the agents do the coordination. Email with the boring parts removed.

**The network effect in practice:**
- More connections = more reachable knowledge. A brain with ten connections can answer questions that a brain with zero connections cannot.
- Trust is transitive (with limits). Connected brains can broker introductions or relay scoped queries — with explicit consent from all parties.
- The graph compounds. Early adopters create a collaboration substrate that makes the product dramatically more valuable for the next adopter.

This is a *trust* network, not a social network. There is no feed, no follower count, no public profile. It is a private graph of bilateral trust relationships, each with explicit permissions. The value comes from the quality of connections, not the quantity.

**Product spec and sequencing:** [IDEA: Brain-to-brain collaboration](ideas/IDEA-wiki-sharing-collaborators.md). First concrete step: [OPP-064](opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md).

---

## What this is not

- A generic AI chatbot. The whole point is personalization.
- A replacement for email or calendar apps. It's a layer on top of them.
- A shared team workspace. The unit is a person: every user has their own Braintunnel. Brain-to-brain collaboration is peer-to-peer, not a shared org workspace like Notion or Slack.
- An Obsidian plugin or a notes app. The wiki is a means to an end — grounding the assistant — not the primary interface.

