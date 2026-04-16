# Vision

## What this is

A personalized assistant that magically knows everything about you — your people, projects, interests, travel, and history — and gets smarter over time. Not a generic chatbot you have to re-explain yourself to every session. A second brain: one that reads your email, watches your calendar, remembers what you told it, and builds a living knowledge base from your actual life.

The assistant is genuinely useful on day one (email search, calendar lookup, quick notes) and becomes indispensable over months as the wiki fills in. The magic is the compounding — every interaction either answers a question or adds something to the brain.

### Personal wiki (what we call it)

We use **wiki** on purpose: it is a familiar pattern—**linked text pages** (like the public sites built on the same idea), but **private and yours**. Brain helps you **create and maintain** that wiki so it captures what matters; the assistant then **reads** it to stay personalized instead of generic. New users do not need prior wiki experience—[product copy and onboarding framing](product/personal-wiki.md) explain it in plain language.

---

## Inspiration

**Andrej Karpathy's second brain workflow** — Karpathy writes about maintaining a personal knowledge base in an Obsidian vault: notes, links, people, ideas, all cross-referenced and searchable. The insight is that the value of a knowledge base isn't in any single note — it's in the network of connections that builds up over time, and in having a single place to put things so they're not lost.

**ripmail** — Email is the richest personal data source most people have. It contains your relationships (who you talk to, about what, how often), your history (travel, purchases, projects), and signals about what matters to you. ripmail makes that data actually queryable. Combine a searchable email index with a growing wiki and you have the raw material for a genuinely personalized assistant.

The combination: a wiki that you (and the assistant) actively maintain, grounded by email and calendar data, queried through natural language. The Obsidian vault, but one that builds itself.

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

**Long term (the magic):** Automatic wiki scaffolding on signup — the assistant reads email history and bootstraps the wiki with pages for frequent contacts, ongoing projects, and recurring topics. Proactive suggestions: "you haven't followed up with X in a month," "you have a trip to Y coming up, want me to pull together your notes?" The brain grows passively, not just when you explicitly ask it to.

---

## What this is not

- A generic AI chatbot. The whole point is personalization.
- A replacement for email or calendar apps. It's a layer on top of them.
- A team tool. The unit is a person, not an organization. Every user has their own brain.
- An Obsidian plugin or a notes app. The wiki is a means to an end — grounding the assistant — not the primary interface.
