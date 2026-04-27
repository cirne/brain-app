# Copy Style Guide

This guide defines the voice, tone, and standards for copy throughout **Braintunnel**. Refer to this guide when writing UI text, agent prompts, or system messages to ensure a consistent and user-focused experience. The repository is `brain-app`; the product name is **Braintunnel**.

## Core Principles

1. **User-Benefit Focused**: Focus on what the user gains or can do, not what the system is doing internally.
2. **Human-Centric**: Use natural language. Avoid "inner code" terms or implementation details.
3. **Concise & Actionable**: Be brief. Respect the user's time. Avoid repetition.
4. **Transparent but Simple**: Explain what's happening without exposing the "plumbing."

---

## Voice & Tone

- **Voice**: Helpful, intelligent, and private. Braintunnel is a personal extension of the user's mind.
- **Tone**: Professional but approachable. Calm and steady, especially during background tasks.

---

## The "No-Plumbing" Rule

Avoid exposing implementation details or agent-specific jargon. The user doesn't need to know *how* the agent is working, only *what* it is doing for them.


| Avoid (Implementation Detail)                   | Prefer (User Benefit)                       |
| ----------------------------------------------- | ------------------------------------------- |
| "SeedingAgent is running `search_index`..."     | "Finding relevant threads in your inbox..." |
| "Calling `seedingAgent.ts` to populate wiki..." | "Building your personal knowledge base..."  |
| "Executing `upsert` on `people/jane-doe.md`..." | "Updating Jane Doe's profile..."            |
| "Agent is idle, waiting for tool output..."     | "Analyzing your data..."                    |


---

## Vocabulary & Jargon

Avoid developer-centric terms that leak from the codebase.


| Inner Code Term                                   | User-Facing Term                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Seed / Seeding**                                | Initialize, Build, Populate, Setup                                                                                         |
| **Agent / Tool / Call**                           | Assistant, Feature, Action (or just describe the action)                                                                   |
| **Slug**                                          | Name, Link, ID (if necessary)                                                                                              |
| **FTS / Semantic**                                | Search, Smart Search                                                                                                       |
| `**BRAIN_HOME` / paths / “vault” folder on disk** | **Your vault**, **unlock your vault**; for local desktop only, phrasing like **vault on this Mac** is fine when it is true |


**Vault vs wiki:** **Vault** is user-facing for the **secured store** (password, unlock, where durable data lives). **Wiki** is user-facing for **Markdown pages and links inside the vault**. Do not use **wiki** when you mean unlocking or the whole datastore—use **vault**. **Product name:** use **Braintunnel** in user-facing copy. Repository / env / paths may still say `brain-app` or `BRAIN_`* — that is internal; do not expose raw path names in UI.

### Desktop (single-tenant) vs hosted (multi-tenant) copy

We ship both a **local desktop** product and a **hosted** deployment. The same UI may run in either; phrasing about **this Mac / this device / only on your machine** is accurate for desktop, not for cloud.

- **Onboarding and account setup** are the right place for product-line splits. Use **separate lead blocks** (e.g. `profilingLeadCopy` vs `profilingLeadCopyMultiTenant` in `onboardingLeadCopy.ts`, or a `multiTenant` prop with two full variants) instead of one paragraph crammed with inline conditionals.
- **After onboarding completes, prefer one shared set of product copy** (Hub, chat, wiki help, most settings): wording that is true for both deployments, without `multiTenant ? … : …` sprinkled through the app for small tone differences. Reserve branching for when **behavior** in the product actually differs in a way the user must understand.
- When in doubt in shared surfaces, choose **hosting-accurate** wording: avoid implying data exists only on the user’s computer or that a local app must be “running” for background work, unless that is true for all users who see the screen.

---

## Common Mistakes & Gotchas

### 1. The "Agent Narrator" Problem

Agents often narrate their own code execution (e.g., "I am now going to use the `read_email` tool to..."). 

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

## Cleanup Checklist

When reviewing a page, ask:

1. **Does this term exist in the source code?** If yes, is there a better "human" word for it?
2. **Is this too technical?** Would my non-developer friend understand "seeding the vault"?
3. **Is it redundant?** Am I telling the user what I'm doing while they can clearly see the result?
4. **Is it "Agent-y"?** Does it sound like a robot describing its own circuits?
5. **Is this post-onboarding UI?** If so, is the copy true for both desktop and hosted, without unnecessary `multiTenant` (or similar) branches?