# Archived: OPP-006 (Email-Bootstrap Onboarding)

**Status: Done enough — archived.** The core email-bootstrap onboarding flow has shipped. Users connect email (Apple Mail local or Gmail OAuth), ripmail indexes the inbox, a profiling agent builds `wiki/me.md` with a human review gate, and a seeding agent populates the wiki. The full vision in this doc served as the design spec; what shipped covers the essential "connect email → get a wiki in minutes" promise.

**What shipped:**
- `/onboarding` route with multi-step flow (email source → indexing → profiling → review → seeding → done)
- Profiling agent: samples sent mail, frequent contacts, recurring subjects; writes to a temp file; user reviews and edits via chat loop; writes `wiki/me.md` on accept
- Seeding agent: uses accepted profile + category confirmation to populate people, project, and interest pages
- `wiki/me.md` injected into main agent system prompt for personalized context on every subsequent chat
- Apple Mail local path and Gmail OAuth path both working
- Resumable state machine (persisted across browser close)

**What was deferred (open for future OPPs if needed):**
- Sensitive-data opt-out step before seeding (finance, health suppression)
- Periodic "re-analyze inbox" refresh flow
- Personalized `/email` skill seeded from user's sent-mail voice (OPP-010)
- Post-seeding "wow" first chat moment (see archived OPP-018)
- Local folder suggestions step (see archived OPP-014)

---

# OPP-006: Email-Bootstrap Onboarding

## Vision

User connects their email. Within minutes — with zero data entry — Brain has learned who they are, who matters to them, what they're working on, and started building their wiki. The user watches pages appear in real-time: their profile, key people, active projects, recurring themes. It feels like magic.

Email is the gold mine. Years of context, relationships, decisions, and priorities — all sitting there, already structured by time and conversation.

## User mental model: personal wiki → personalized assistant

Before asking for mail access, onboarding should establish **what Brain is building** and **why it matters**:

1. **A wiki** (in simple terms) is a collection of **linked text pages**—the same *shape* as sites like Wikipedia, but **private**: Brain's job is to help maintain **your** wiki about **your** life.
2. **Email and calendar** are how Brain **fills that wiki quickly** in the first minutes—so the user is not staring at a blank vault.
3. **The assistant** then **uses** that wiki (plus tools) to answer and draft in **your** context—grounded personalization, not a cold chatbot.

This orients first-time users who have never used "wiki" in a product before and connects the technical artifact (`WIKI_DIR`, markdown files) to the emotional promise: *memory that belongs to you*. Full copy options and UI placement notes live in [Personal wiki (product)](../product/personal-wiki.md).

**Practical implication:** The first onboarding screen (or the copy above the "connect email" step) should include a **short** version of this story; the indexing and seeding steps stay as today, but the user understands *why* pages are appearing.

## Proof of concept

A single prompt to Claude Code with ripmail access:

> "Imagine you know nothing about me except my email address. Using ripmail only, examine email history, sent mails, etc. to build a high level profile of [lewiscirne@gmail.com](mailto:lewiscirne@gmail.com): name, occupation, interests, projects, key people, etc. Your goal is to build a markdown profile of no more than 100 lines."

**Result:** In ~60 seconds, the agent produced a comprehensive identity file including:

- Full name, locations (Austin + Cabo), education (Dartmouth '93), spouse
- Career arc: Wily → New Relic (with "Christmas 2011 first lines of NRDB" detail) → Gamaliel → BICF
- Operating structure: Green Longhorn team with roles (Sterling = chief of staff, Donna = EA, Howie = calendar)
- Key contacts table with 10 people, domains, and roles
- Communication style: "Signs off as Lew, direct, warm, delegates logistics to Sterling"
- Agent-specific guidance: "Treat him as an experienced software engineer, not a business user"

This validates the approach. The email goldmine is real, and the bootstrap process works.

## The experience

The onboarding UI lives at `/onboarding` in the web app — a full-page flow, not a modal. It is triggered on first launch (no `wiki/me.md` exists) or via a "Re-run onboarding" option later.

### Step 1: Pick your email source

"Let's get started with your email."

- **Apple Mail (local)** — ripmail reads your local mail store directly. One click to allow macOS access. Nothing leaves your Mac.
- **Gmail** — OAuth flow. Works on any machine.

Apple Mail is the preferred path for Mac users: faster (local disk), no credentials, and privacy-preserving. macOS will show its native permission dialog; the UI explains what's happening before it fires and handles "Don't Allow" gracefully.

### Step 2: Indexing

ripmail begins indexing immediately in the background. The UI polls `ripmail status` and shows a live counter:

> "Indexed 1,240 emails from the last 30 days..."

**Ready threshold:** last 30 days indexed, or 200+ emails — whichever comes first. Apple Mail indexing is typically seconds (local disk); Gmail may take longer (network IMAP). A "Start anyway" escape hatch is available.

### Step 3: Building your profile (profiling agent)

A specialized onboarding agent runs with ripmail tools and a focused system prompt. The existing chat UX streams its output — the user sees the agent thinking, searching email, and drafting. "Building your profile..."

The agent writes to a **temp file** (not `wiki/me.md`) until the user accepts. This keeps the wiki clean if onboarding is abandoned.

Takes ~60 seconds.

### Step 4: Review your profile

The completed profile is shown alongside a chat input. The user reads it; if it looks good, they click **Accept**. If not, they type corrections:

> "My wife's name is Kirsten, not Kirstin"
> "Remove the Gloo section — that's a company, not a project"

The profiling agent is still live. It hears the request, calls its `edit` tool on the temp file, and the rendered profile updates in place. This loop continues until the user accepts.

On accept, the temp file is written to `wiki/me.md`.

**UI reuse:** This is the core AgentChat + wiki panel layout — the profile document is the context panel, the chat input is below. High reuse of existing components.

### Step 5: Building your wiki (seeding agent)

A second, separate agent takes over. Before running, it presents a category plan based on what it found:

> "Based on your email, I'd suggest starting with:
> ✓ People (47 frequent contacts)
> ✓ Projects (Gloo, Gamaliel, Cabo property, ...)
> ✓ Interests (faith, travel, software)
> ✓ Areas (family, finances, health)
> → Start building"

User can deselect categories they don't want, then confirms. The agent runs — creating files, linking pages, narrating as it goes. The existing chat UX streams everything: tool calls, reasoning, file creation. No special pacing needed; the agent naturally narrates before it acts.

Takes 2-4 minutes.

### Step 6: Done

Summary: "Created 23 pages across 4 categories." CTA lands on `wiki/me.md` — the user's profile — so the first thing they see is themselves accurately reflected back.

---

## Core idea: the user profile

A special markdown file `wiki/me.md` that captures:

```markdown
---
updated: 2026-04-15
type: user-profile
---

# Lewis Cirne

## Identity
- Email: lewiscirne@gmail.com
- Location: Austin, TX (inferred from calendar/emails)
- Professional: Software entrepreneur, founded New Relic

## Current focus
- Gamaliel project (AI + Bible study)
- Family health coordination
- Philanthropy via BiCF

## Key relationships
- [[people/kirsten-cirne]] — wife
- [[people/sterling-...]] — assistant
- [[people/...]] — frequent collaborators

## Communication style
- Direct, concise
- Prefers bullet points over prose
- Signs emails "Lew"

## Active threads
- Gloo IPO timeline
- Katelyn's care transition
- Cabo property decisions
```

**This file gets injected into the main agent's system prompt**: "Read the user's profile first." The agent starts every conversation knowing who it's helping.

---

## Two-agent design

Onboarding uses two distinct specialized agents, not one:


| Aspect           | Profiling Agent                     | Seeding Agent                              | Main Agent         |
| ---------------- | ----------------------------------- | ------------------------------------------ | ------------------ |
| Purpose          | Build `wiki/me.md`                  | Populate wiki from profile                 | Ongoing assistance |
| Runs             | Once during onboarding              | Once during onboarding                     | Every conversation |
| Tools            | ripmail search/read, edit           | ripmail search/read, write/edit wiki files | Full toolset       |
| System prompt    | "Analyze inbox, build user profile" | "Seed this wiki using email + profile"     | "Help the user"    |
| User interaction | Chat loop for corrections           | Passive watching                           | Active chat        |
| Output           | `wiki/me.md`                        | Wiki pages                                 | Responses          |


**Why two agents?**

- The profiling agent outputs one document and needs a human review gate before anything is written to the wiki.
- The seeding agent takes the accepted profile as *input* — it's a different job with a different prompt.
- Clean separation enables resumability: if the user closes the browser between phases, the system knows exactly where to resume.

**UI reuse:** Both agents stream via the existing SSE chat infrastructure. The onboarding UI is largely the same AgentChat layout in a different context — just a different agent and system prompt on the server side.

---

## What the profiling agent does

### Phase 1: Identity (30-60 seconds)

1. **Sample recent sent emails** — Last 100-200 sent
2. **Extract identity signals:**
  - Email signature → name, title, contact info
  - Common sign-offs → communication style
3. **Draft initial profile** — Write to temp file

### Phase 2: Relationships

1. `**ripmail who --limit 50`** — Top contacts by frequency
2. **Cluster by domain** — Work colleagues, family, services
3. **Sample threads per contact** — Infer relationship type
4. **Add key relationships section** to profile

### Phase 3: Projects and focus areas

1. **Search for recurring subjects** — Thread clusters, repeated proper nouns
2. **Look for project signals** — "Re: [Project Name]" patterns
3. **Add current focus + active threads** to profile

---

## What the seeding agent does

Given: accepted `wiki/me.md` + confirmed category list.

1. **People pages** — Top contacts, inferred from email threads
2. **Project pages** — With context, status, and cross-links to people
3. **Interest/area pages** — Synthesized from email patterns
4. Narrates throughout; user watches via streaming chat UX

---

## Onboarding state machine

```
idle → indexing → profiling → reviewing-profile → confirming-categories → seeding → done
```

State is persisted (JSON file or DB row) so the flow is resumable if the browser is closed.

---

## Research questions

1. **How much email is enough?** 30 days is the starting assumption; may need tuning by inbox density.
2. **How aggressive should inference be?** Create a page for everyone with 5+ emails? 10+? Only after clustering?
3. **How to handle ambiguity?** Same name, different people. Company vs project vs product.
4. **Profile review UX depth?** Simple accept/decline vs full chat loop. Start simple, add chat loop iteration.
