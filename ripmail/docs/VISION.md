# Agent-First Email
## Vision

> Architectural decisions and the technical design log live in [ARCHITECTURE.md](./ARCHITECTURE.md).
> Competitive positioning and strategic differentiation live in [STRATEGY.md](../../docs/STRATEGY.md).
> Product improvement opportunities live in [OPPORTUNITIES.md](./OPPORTUNITIES.md).

### Summary

Modern email systems (Gmail, Outlook, etc.) are **human-first interfaces** designed around inbox browsing and manual workflows.

They are poorly suited for the emerging world of **AI agents and programmatic interaction**.

Agent-First Email reimagines email as a **queryable dataset and filesystem-like repository of communication artifacts**, where the primary interface is **tools and APIs for agents**, and the human UI is optional.

Instead of browsing inboxes, agents **query communication graphs**.

**User promise:** ripmail lets you **never have to look at your inbox again**. Inbox infinity instead of inbox zero — you stop fighting to empty the inbox because the system is agent-first and **lightning-fast searchable**. Your email becomes an asset again: you actually *want* everything in your email because it’s **actionable** — Zoom meeting notes, travel confirmations, automated invoices, receipts, and more, all **agent-ready** because they live in your mail. Tools like Claude Code or OpenClaw **just work** once ripmail is installed: the LLM turns your natural-language prompts into the right ripmail queries, fetches the data, and assembles the answer.

**End state:** ripmail + agent harness (Claude Code, OpenClaw, etc.) = **never open your inbox or send an email again**. The agent is the interface. You read through it. You write through it.

---

# How you run it: Rust binary CLI

ripmail ships as a **small prebuilt Rust binary** (installed via a one-line script from GitHub Releases). **The CLI is the product** — subprocess-friendly JSON and text, fast startup, no Docker requirement, no separate language runtime.

Agents invoke `ripmail` like any other local tool: search, read, draft, send. Humans can use the same binary from a terminal or let the coding agent drive it end-to-end.

---

# What ripmail is for (the big capabilities)

These are the pillars we optimize for:

1. **Multi-inbox — one agent surface for all your mail**  
   Configure multiple accounts (work Gmail, personal IMAP, etc.). **One** ripmail install under your home directory; **one** place for an agent to **query, triage, and monitor every mailbox** — search and read across accounts, refresh/sync, and see status without switching contexts or UIs.

2. **`who` — people are first-class**  
   Contacts and “who do I talk to?” are part of the dataset, not an afterthought. **`ripmail who`** (and related flows) let agents answer questions about people and correspondence patterns, not only about individual messages.

3. **Send mail on your behalf — with drafts you review**  
   Outbound mail uses **SMTP send-as-user** through each provider (same identity, messages in Sent, no separate deliverability story). The agent can **`ripmail draft`** (new, reply, forward, refine with instructions) and prepare sends; **you review the draft and confirm before it goes out** — intent → draft → **your approval** → send. The product end state stays: the agent does the work; you stay in control at send time.

4. **Fast local search and read**  
   Mail syncs over IMAP into local storage and an index; agents get **low-latency search**, thread/read, and attachment-aware retrieval so the LLM can iterate in a tight loop.

Higher-level flows (`inbox`, `ask`, rules-driven triage, etc.) sit on top of that core; the vision doc stays anchored on these pillars.

---

# “Just works” in the agent (reliably, fast)

When you’re in Claude Code (or another coding agent) with ripmail wired up, these kinds of prompts should **just work** — the agent uses ripmail tools to fetch the right mail and then answers. The LLM’s job: map your prompt to the right ripmail queries and synthesize the result.

**Example user prompts:**

- **“Look at all my invoices and summarize all of my spending online.”**  
  Agent: search for invoices/receipts (e.g. from known senders or subject/body), fetch threads or attachments, extract amounts and categories, summarize.

- **“Summarize my meeting notes from last week’s Zoom with Larry.”**  
  Agent: search for Zoom emails (e.g. “Zoom” + “Larry” + last week), open the meeting summary/notes, summarize for the user.

- **“When is my flight to Cabo taking off? What’s my confirmation number?”**  
  Agent: search for Cabo/travel/booking emails, find the itinerary or confirmation, return departure time and confirmation number.

- **"RSVP yes to the dinner invite from Sarah."**  
  Agent: find the invite (`ripmail search` / `read`), **`ripmail draft reply`** (and **`ripmail draft edit "…"`** to refine with the LLM), **you review the draft**, then **`ripmail send <draft-id>`**. No inbox UI. No compose window.

In each case: **user asks in plain language → LLM issues ripmail search / ripmail read (or thread) (and attachment) calls → LLM assembles the answer.** No inbox opening, no manual digging. Reliable and fast.

---

# Core Principles

1. **Agent-first**
   - Programmatic access is the primary interface.
   - Humans interact through tools built on top.

2. **Local-first / privacy-first**
   - Users control their own email data on disk.
   - The system runs locally as a single binary plus data under your home (or `RIPMAIL_HOME`).

3. **Filesystem-native**
   - Email stored as files (Maildir style).
   - Agents work against a stable local corpus and index.

4. **Fast indexed search**
   - Lexical search and structured metadata queries at minimum; richer retrieval can evolve over time.

5. **Open standard**
   - Agent tools should rely on a stable, documented interface.
   - The system could become the **standard email layer for AI agents**.

6. **Agent-intuitive interfaces**
   - We optimize for **discoverability** and **iterative learning**: commands and query syntax should match what agents naturally try (e.g. `ripmail search "from:... term OR term"`, `ripmail read <message_id>`).
   - When invocations fail, we output **token-efficient, corrective** help so the LLM can self-correct without a large generic help dump. The best CLI is the one the agent would instinctively use and can learn from iteratively — the agent analogue of a world-class human interface.

---

# Problem

Email systems today suffer from:

- Slow and limited search
- Poor programmatic access
- Siloed data stores
- UI-centric workflows
- No agent integration

Email is one of the **largest communication datasets in existence**, yet it remains largely inaccessible to automation.

---

# Solution

Build an **Agent-First Email System** that:

- Synchronizes mail from existing providers
- Stores mail locally
- Indexes it for fast retrieval
- Exposes a **single CLI** that agents use for **all configured mailboxes** — query, monitor, draft, and (after your review) send

This transforms email from:

```
Inbox UI
```

into:

```
Queryable communication dataset
```

---

# Integration with providers (today vs future)

## Today: clone / copy mode

The system synchronizes email from existing providers over **IMAP** (and sends via **SMTP** as the same user). Gmail, Outlook, Fastmail, and any standards-based IMAP server fit this model.

- User keeps existing addresses and deliverability
- ripmail is the **local intelligence and agent interface** in front of those accounts

## Future: replacement mode

The system could become the user's primary mail provider (MX, ingress, spam, deliverability). That path maximizes control and raises operational complexity — only when/if the product goes there.

---

# Storage and index (brief)

Canonical on-disk mail uses a **Maildir-style** layout; each message is a **raw RFC822** file — simple, durable, easy to back up.

Raw email is preserved, but agents interact through **normalized fields** (ids, headers, body text, attachments metadata) so they are not hand-parsing MIME.

A **local index** (e.g. full-text + metadata) sits beside the files so search and aggregation stay fast. Implementation details belong in [ARCHITECTURE.md](./ARCHITECTURE.md); the vision is **local corpus + index + CLI**.

---

# Agent interface: CLI first

The primary interface is the **`ripmail` CLI** — structured JSON where it matters, text where humans read.

Example commands:

```
ripmail search "from:kirsten subject:contract"
ripmail who
ripmail read <message_id>
ripmail thread <thread_id>
```

Search query can use inline operators: `from:`, `to:`, `subject:`, `after:`, `before:`, and free text with `OR`/`AND` (e.g. `ripmail search "from:alice@example.com invoice OR receipt"`).

The same binary can grow **additional surfaces** later (HTTP, editor plugins, etc.); the contract agents rely on should remain **stable, scriptable, and documented**.

---

# Email as a queryable dataset

Traditional email treats messages as inbox items.

Agent-First Email treats email as a **structured dataset**.

Examples:

```
"find emails discussing pricing strategy"

"show threads where a decision was made"

"summarize customer complaints last quarter"
```

---

# The full loop: read, draft, review, send

ripmail covers **read + write** for the core loop: sync and index (IMAP), search and read locally, then **draft and send** (SMTP send-as-user). **Sending on your behalf** is always paired with **review**: the agent prepares content; **you confirm before a message leaves** (see [ARCHITECTURE.md](./ARCHITECTURE.md) ADR-024).

Over time, ripmail can use **your sent history** to better match voice and register per recipient — drafts that sound like you, in context — without changing the principle that **outbound mail is deliberate**.

---

# Long-term vision

Email becomes the foundation of a **communication graph**.

Additional data sources may include:

- Slack
- Google Docs
- Notion
- Jira
- Zoom transcripts
- Ticket systems

Optional future surfaces could include a **virtual mailbox filesystem** (e.g. threads and attachments as paths) so coding agents explore mail like a repo — complementary to the CLI, not a replacement.

Eventually the system becomes:

```
AI-ready communication memory
```

Example query:

```
"show the emails, meetings, and documents that led to the pricing decision"
```

---

# Business model (open source)

Core system:

**Open source**

Revenue opportunities:

### Hosted indexing service

Users sync their email to a hosted index and AI layer.

### Developer APIs

Agents and applications query communication data.

### Enterprise knowledge graph

Organizations build a company-wide communication intelligence layer.

---

# Working name

**ripmail**

```
Standard interface for agent-accessible communications
```

---

# Attachment intelligence

Attachments are part of the dataset: extract text where possible, expose list/read to agents, and keep search useful across bodies and files (PDF, office formats, HTML, CSV, plain text, with room to grow).

---

# Key insight

The goal is not to build another email client.

The goal is to transform email from:

```
Inbox
```

into:

```
Communication dataset
```

for humans **and** AI agents.
