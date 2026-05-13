# Copy Style Guide

This guide defines the **voice**, **tone**, **vocabulary**, and **rules** for copy throughout **Braintunnel**. Use it when writing UI text, agent prompts, or system messages so the product feels consistent and user-focused. The repository is `brain-app`; the product name is **Braintunnel**.

**What belongs here:** how we write — principles, jargon maps, deployment-sensitive wording, and checklists.

**What lives elsewhere:** go-to-market segment, positioning, roadmap, and long-form product narrative. Treat **[STRATEGY.md](./STRATEGY.md)**, **[VISION.md](./VISION.md)**, and **[the-product-question.md](./the-product-question.md)** as the sources of truth for those; update this guide when strategy shifts only if **voice or vocabulary** needs to follow (especially the short **Audience & posture** section below).

## Core Principles

1. **User-Benefit Focused**: Focus on what the user gains or can do, not what the system is doing internally.
2. **Human-Centric**: Use natural language. Avoid "inner code" terms or implementation details.
3. **Concise & Actionable**: Be brief. Respect the user's time. Avoid repetition.
4. **Transparent but Simple**: Explain what's happening without exposing the "plumbing."

---

## Audience & posture

Default reader: someone **smart and busy** who does not ship software. They want speed, clarity, and trustworthy handling of sensitive mail, calendar, and notes. Prefer **professional and approachable** language: calm steady voice, modest claims tied to outcomes (what they can do or verify), privacy-forward wording without fear-mongering.

Segment and bets (narrow B2B, trust/network story, “second brain”) are articulated in **[STRATEGY.md](./STRATEGY.md)** and **[VISION.md](./VISION.md)**; tune onboarding and marketing-adjacent copy there first, then align surface vocabulary here.

**Register:** Prefer concrete outcomes over hype. Reserve words like **magic** for moments that tie to an observable benefit (e.g. “knows your context”) rather than empty superlatives.

---

## Voice & Tone

- **Voice**: Helpful, intelligent, and private. Braintunnel is a personal extension of the user's mind.
- **Tone**: Professional but approachable. Calm and steady, especially during background tasks.

---

## Jobs we support in copy (short list)

Writers should be able to check headlines and hints against **what Braintunnel is for**, without copying long specs:

- **Mail-aware answers**: find threads, drafts, replies grounded in what's actually in the inbox.
- **Calendar**: schedule accuracy, chats about availability and events when connected.
- **Wiki as memory**: linked Markdown notes inside the vault the assistant reads to stay personalized.
- **Chat**: primary interface for asking and doing — describe it in everyday terms, not “the agent runtime.”

**Non-goals in user-facing framing** (avoid contradicting **[VISION.md](./VISION.md)**):

- Replacing Gmail, Calendar, or the user’s mail client outright — Braintunnel is **a layer** on connected accounts.
- A generic mass-market cowork space — emphasize **personal brain** or **delegated collaboration** where that product behavior exists.

---

## The "No-Plumbing" Rule

Avoid exposing implementation details or agent-specific jargon. The user doesn't need to know *how* the agent is working, only *what* it is doing for them.

| Avoid (Implementation Detail)                   | Prefer (User Benefit)                       |
| ----------------------------------------------- | ------------------------------------------- |
| "SeedingAgent is running `search_index`..."     | "Finding relevant threads in your inbox..." |
| "Calling `seedingAgent.ts` to populate wiki..." | "Building your personal knowledge base..."  |
| "Executing `upsert` on `people/jane-doe.md`..." | "Updating Jane Doe's profile..."            |
| "Agent is idle, waiting for tool output..."     | "Analyzing your data..."                    |

**Agent prompts vs web UI:** Server prompt templates (`src/server/prompts/**/*.hbs`) follow the same no-plumbing bar but are **not** part of the web i18n JSON tree — see **[docs/architecture/i18n.md](./architecture/i18n.md)** scope.

---

## Vocabulary & Jargon

Avoid developer-centric terms that leak from the codebase.

| Inner Code Term                                   | User-Facing Term                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Seed / Seeding**                                | Initialize, Build, Populate, Setup                                                                                         |
| **Agent / Tool / Call**                           | Assistant, Feature, Action (or just describe the action)                                                                   |
| **Slug**                                          | Name, Link, ID (if necessary)                                                                                              |
| **FTS / Semantic**                                | Search, Smart Search                                                                                                       |
| **Brain query / B2B / grants / policy strings** | Permission-based Q&A across people you work with; **approve before sending**; who can ask what — not “grant row” / “brain_query_mail” |
| **Notifications / inbox (product)**               | What needs attention — **reviews**, asks, approvals — unless the UI is explicitly the mail **Inbox** surface               |
| **BRAIN_HOME** / repo paths / “vault” on disk      | **Your vault**, **unlock your vault**; for local desktop only, phrasing like **vault on this Mac** is fine when it is true |

**Surfaces (headline-level hints):**

- **Hub**: schedule-centric home; emphasize calendar + upcoming context without syncing jargon.
- **Chat / Assistant**: conversation with the personalized assistant — prefer **assistant** or **chat** over **agent** in UI.
- **Inbox**: ripmail-backed mail UX — use mail vocabulary (threads, messages), not codebase mail module names.

**Vault vs wiki:** **Vault** is user-facing for the **secured store** (password, unlock, where durable data lives). **Wiki** is user-facing for **Markdown pages and links inside the vault**. Use **notes** / **pages** when it reads more naturally than forcing “wiki” in every headline. Do not use **wiki** when you mean unlocking or the whole datastore — use **vault**. **Product name:** use **Braintunnel** in user-facing copy. Repository / env / paths may still say `brain-app` or `BRAIN_*` — that is internal; do not expose raw path names in UI.

Engineering terminology for delegation and trust (markers, scopes, mail templates) stays in **[docs/architecture/brain-query-delegation.md](./architecture/brain-query-delegation.md)** and related architecture docs — do not paste those identifiers into UI.

### Desktop (single-tenant) vs hosted (multi-tenant) copy

We ship both a **local desktop** product and a **hosted** deployment. The same UI may run in either; phrasing about **this Mac / this device / only on your machine** is accurate for desktop, not for cloud.

- **Onboarding and account setup** are the right place for product-line splits. Use **separate lead blocks** (e.g. `profilingLeadCopy` vs `profilingLeadCopyMultiTenant` in `onboardingLeadCopy.ts`, or a `multiTenant` prop with two full variants) instead of one paragraph crammed with inline conditionals.
- **After onboarding completes, prefer one shared set of product copy** (Hub, chat, wiki help, most settings): wording that is true for both deployments, without `multiTenant ? … : …` sprinkled through the app for small tone differences. Reserve branching for when **behavior** in the product actually differs in a way the user must understand.
- When in doubt in shared surfaces, choose **hosting-accurate** wording: avoid implying data exists only on the user’s computer or that a local app must be “running” for background work, unless that is true for all users who see the screen.

**Example (shared surface):**

- **Avoid**: “Your mail stays only on this computer.” (false for hosted.)
- **Prefer**: Neutral outcome copy, or branch only where behavior differs (“Braintunnel won’t sync until you unlock your vault” when that is universally true on-screen).

**Security and trust:** Do not promise properties (e.g. end-to-end encryption, staff never seeing data) unless they are accurate for that deployment and documented; align bold claims with **[SECURITY.md](./SECURITY.md)**.

---

## i18n and shipped English

Operational rules live in **[docs/architecture/i18n.md](./architecture/i18n.md)**. Brief alignment:

- English source strings: **`src/client/lib/i18n/locales/en/*.json`** (namespaces such as `common`, `nav`, `chat`, `hub`, `inbox`, `wiki`, `access`, `onboarding`).
- Prefer **consistent product terms** between this guide and those JSON files; when extracting new strings, check existing keys in the relevant namespace before coining synonyms.
- Localize **`title`**, **`aria-*`**, and placeholders with the **same vocabulary** as visible text — accessible names must stay human and jargon-free.

---

## Accessibility and typography

Use clear control labels (**Save**, **Approve**, **Connect account**) rather than jargon. Prefer **sentence case** for UI labels unless a proper noun (**Braintunnel**) requires capitals.

Avoid problematic characters in user-visible strings unless the design system explicitly supports them — for example Unicode **§** often renders poorly; prefer plain headings or commas.

---

## Common Mistakes & Gotchas

### 1. The "Agent Narrator" Problem

Agents often narrate their own code execution (e.g., "I am now going to use the `read_mail_message` tool to...").

- **Fix**: Update agent system prompts to focus on the result, not the process.
- **Example**: Instead of "I will now read your email to find a phone number," use "Finding contact details..."

### 2. Repetition & Wordiness

Don't say the same thing in the title, description, and status line.

- **Fix**: Use the title for the *what*, and the status for the *current progress*.
- **Example**:
  - *Bad*: Title: "Inbox Summary", Text: "I am summarizing your inbox now. Summarizing 10 emails..."
  - *Good*: Title: "Inbox Summary", Text: "Summarizing 10 recent emails..."

### 3. Passive vs. Active Voice

Use active voice to make the app feel responsive.

- **Prefer**: "Braintunnel is indexing your mail" over "Your mail is being indexed by the system."

---

## Calendar picker (Hub)

Post-onboarding Hub copy should stay **deployment-neutral** where possible. Explain **what the user gains** (schedule + chat stay accurate) without plumbing (“sync everything vs query subset”) or inner jargon (**agent** → describe chat or say **assistant** if needed).

**Canonical strings** (defaults in [`CalendarPicker.svelte`](../src/client/components/calendar/CalendarPicker.svelte)):

- **Hint**: Your calendars stay updated automatically. Choose which ones Braintunnel shows first in your schedule and when you chat about your calendar.
- **Empty**: No calendars found yet. Try refreshing once your calendar account has connected.

---

## Visual design system

Tone and vocabulary here complement visual tokens (color, typography, spacing) in **[DESIGN.md](../DESIGN.md)** and `src/client/style.css`. Copy should not contradict design intent — e.g. calm reassurance during long-running work — but DESIGN.md remains the SSOT for **how it looks**.

---

## Related docs

| Doc | Purpose |
| --- | ------- |
| [STRATEGY.md](./STRATEGY.md) | Segments, moats, brain-to-brain positioning |
| [VISION.md](./VISION.md) | Product narrative; jobs; non-goals |
| [the-product-question.md](./the-product-question.md) | JTBD / category framing (open analysis) |
| [architecture/i18n.md](./architecture/i18n.md) | Namespaces, `$t`, locales, checklist |
| [DESIGN.md](../DESIGN.md) | Visual design system |
| [SECURITY.md](./SECURITY.md) | Trust claims must match documented posture |

---

## Keeping this guide fresh

1. After meaningful **strategy** changes, skim **Audience & posture** and **Jobs / non-goals** for mismatches — one paragraph tweak is usually enough.
2. When shipping a new **surface** or **namespace**, add coined terms either here (jargon map) or by reusing existing English JSON phrasing — avoid duplicate synonyms across features.
3. When adding delegation or mail-notification UX, reconcile user-facing wording with **`access`**, **`chat`**, **`inbox`** JSON and architecture docs — not raw route or tool identifiers.

---

## Cleanup Checklist

When reviewing a page, ask:

1. **Does this term exist in the source code?** If yes, is there a better "human" word for it?
2. **Is this too technical?** Would my non-developer friend understand it?
3. **Is it redundant?** Am I telling the user what I'm doing while they can clearly see the result?
4. **Is it "Agent-y"?** Does it sound like a robot describing its own circuits?
5. **Is this post-onboarding UI?** If so, is the copy true for both desktop and hosted, without unnecessary `multiTenant` (or similar) branches?
6. **Accessibility:** Are `aria-*` / button labels aligned with the same vocabulary as visible text?
