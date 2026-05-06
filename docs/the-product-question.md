# The product question

**Status:** Open strategic analysis — not a decision document. Companion to **[the-wiki-question.md](./the-wiki-question.md)** (which asks *"is the wiki worth maintaining?"*) and **[STRATEGY.md](./STRATEGY.md)** (which is the SSOT for positioning). This doc asks: *"Given the personal-AI-assistant category in mid-2026, what narrow job-to-be-done lets Braintunnel's actual mechanism win, and which framings are category traps to avoid?"*

**Related:** [VISION.md](./VISION.md) · [STRATEGY.md](./STRATEGY.md) · [the-wiki-question.md](./the-wiki-question.md) · [karpathy-llm-wiki-post.md](./karpathy-llm-wiki-post.md) · [product/personal-wiki.md](./product/personal-wiki.md) · [architecture/integrations.md](./architecture/integrations.md) · [architecture/per-tenant-storage-defense.md](./architecture/per-tenant-storage-defense.md) · [architecture/wiki-read-vs-read-email.md](./architecture/wiki-read-vs-read-email.md) · [ideas/IDEA-wiki-sharing-collaborators.md](./ideas/IDEA-wiki-sharing-collaborators.md)

---

## Why this document exists

[VISION.md](./VISION.md) and [STRATEGY.md](./STRATEGY.md) commit Braintunnel to two big bets: (1) **personalization compounds** because the LLM owns a maintained wiki, and (2) **email is the richest personal data source** so [ripmail](../ripmail/README.md) gives the agent ground truth. Today's product is a coherent expression of those bets — but the *category label* under which we go to market is still open.

The temptation is to call ourselves a **personal AI assistant** (or, narrower, an **AI executive assistant**) because that is the recognizable shape: chat that knows you, drafts mail, books meetings, briefs you before calls. The hypothesis under examination is whether that label sharpens or dulls our positioning.

This doc takes the question seriously, surveys the May-2026 landscape, and ends with a recommendation.

---

## What we actually have today (the mechanism, not the label)

A precise inventory of differentiators, separated from features that are now table stakes:

1. **Local-first, single-tenant runtime that ships as both desktop and hosted from one codebase.** Directory-per-tenant storage, Tauri-bundled macOS app with embedded Rust `ripmail` and self-signed local TLS. See [architecture/deployment-models.md](./architecture/deployment-models.md), [architecture/per-tenant-storage-defense.md](./architecture/per-tenant-storage-defense.md), [SECURITY.md](./SECURITY.md).
2. **ripmail as a queryable lifetime mail corpus** — full IMAP backfill into local SQLite + FTS5, plus drafts, identity, contact graph, and unified `sources[]` for files / Drive / future connectors. Not just *Gmail API calls on demand*. See [architecture/integrations.md](./architecture/integrations.md), [`ripmail/docs/ARCHITECTURE.md`](../ripmail/docs/ARCHITECTURE.md), [OPP-087](./opportunities/OPP-087-unified-sources-mail-local-files-future-connectors.md).
3. **LLM-maintained wiki distinct from the mail corpus**, with explicit roles: wiki = synthesized memory, ripmail = evidence; reconciliation rule = newest dated source wins for current-state facts. See [architecture/wiki-read-vs-read-email.md](./architecture/wiki-read-vs-read-email.md), [the-wiki-question.md](./the-wiki-question.md), [OPP-033](./opportunities/OPP-033-wiki-compounding-karpathy-alignment.md), [archived OPP-067](./opportunities/archive/OPP-067-wiki-buildout-agent-no-new-pages.md).
4. **Brain-to-brain network as a future-shaped moat.** Bilateral, scoped trust edges between personal brains — read-only Phase 1 already shipped ([OPP-064 archived spec](./opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md), [OPP-091 archived spec](./opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md), [architecture/wiki-sharing.md](./architecture/wiki-sharing.md)). Sequencing in [IDEA-wiki-sharing-collaborators.md](./ideas/IDEA-wiki-sharing-collaborators.md).
5. **Agent surface that already covers EA-style work**: read/write Gmail, full Google Calendar CRUD ([OPP-070](./opportunities/OPP-070-full-calendar-read-write-agent-surface.md)), drafts with on-disk markdown editing ([OPP-056](./opportunities/OPP-056-email-draft-overlay-markdown-editor.md)), web search/fetch, YouTube transcripts, optional macOS iMessage. Inventory: [`agentToolSets.ts`](../src/server/agent/agentToolSets.ts).

What is **not** a differentiator (everyone in the category claims these by mid-2026):

- "Knows you over time" / persistent memory.
- Email triage, prioritization, draft replies in your voice.
- Calendar scheduling, conflict resolution, briefings.
- Morning briefings / daily digests.
- A personal wiki / second-brain layer.
- Voice input, mobile-first, iMessage-first, macOS-native.
- BYOK / bring-your-own-LLM.

---

## The competitive landscape (May 2026)

The category that the press calls **personal AI agents** has become one of the most crowded segments in tech. The Sawinyh landscape survey ([2026 AI Agent Landscape](https://sawinyh.com/blog/ai-agent-landscape-2026)) and [Ry Walker's comparison](https://rywalker.com/research/personal-agents-platforms) together catalog **40+ active products** and dozens more in the long tail. The relevant clusters:

### Mainstream agent platforms (where most users actually are)

| Product | Position | Why it matters to us |
|---|---|---|
| **Claude Cowork** (Anthropic, $20–200/mo with Claude Pro/Max) | The mainstream winner by a wide margin. Curated desktop agent on local files + apps + browser, with Skills marketplace and 11 first-party plugins (sales, finance, legal, marketing, PM). | Sets the default expectation for "AI that does knowledge work." Bundled with Claude subscription. **Distribution we cannot match.** |
| **Microsoft 365 Copilot / Outlook Copilot** ($30/user/mo) | Embedded in Outlook/Teams/Office. Drafts, summarizes, prioritizes, integrates with calendar. | Owns the enterprise email default. Owns the buyer relationship. |
| **Google Mariner / Astra / Workspace AI** | Chrome- and Android-embedded agents; Workspace-side AI in Gmail/Calendar/Drive. | Owns the consumer Gmail+Calendar default that our ripmail integration depends on. |
| **Notion AI / Notion Mail** | Knowledge-base + AI mail client. Auto-labeling, drafts, thread summary. | The "wiki + AI" category leader for non-technical buyers. |
| **OpenClaw + ecosystem** (open-source, 340K+ GitHub stars) | Self-hosted local agent, 13K+ skills marketplace, 20+ messaging integrations. | Owns the privacy/self-host narrative for hobbyists and developers. Multi-CVE security history is a foothold for trust-led alternatives. |

### Managed AI assistants / EAs (the "we replace your EA" cluster)

| Product | Position | Notes |
|---|---|---|
| **Lindy** ($50/mo, 400K users, Series B) | "AI that runs your work life" — inbox triage, scheduling, meeting prep, briefings. Multi-channel (iMessage/SMS/Slack/email/web). Autopilot for unlimited integrations. | Tier-1 mainstream brand for AI EA. SOC 2 / HIPAA / GDPR. |
| **Manus** (Meta-owned, $100M ARR) | Cloud-hosted autonomous task execution. | Tier-1; bigtech distribution. |
| **Poke** (~$100M val, messaging-native) | iMessage/SMS/Telegram/WhatsApp-first agent. Multi-agent architecture. | Wins the "talk to your agent like a person" niche. |
| **Perplexity Personal Computer** ($200/mo Max) | Always-on Mac agent, March 2026. | New entrant; same desktop niche as us. |
| **April** ($14.99/mo) | Voice-first iPhone EA — email + calendar via AirPods/CarPlay. YC-backed. | Carved out the **commute / hands-free** EA niche. |
| **Consul / Precedent / Arahi (Rahi) / Dume / Ayari** | "AI executive assistant" startups. All include morning briefings, voice-matching drafts, smart scheduling, daily digests, 1500+ app integrations. $50–200/mo. | The "AI EA" SKU is now a commodity bracket — these brands are interchangeable on feature lists. |
| **Lucien / Senchal / Zo / MrDelegate / Personal AI** | Re-positioned as "AI Chief of Staff" for founders/CEOs. Daily briefs with drafted actions, delegation tracking, capacity visibility. | Founder-buyer variant of the same shape. |

### Email + calendar specialists (single-feature incumbents)

| Product | Position | Notes |
|---|---|---|
| **Superhuman** ($30/mo) | AI-enhanced email client, speed + keyboard shortcuts. | Owns the high-end email-client buyer. |
| **SaneBox** ($7/mo) | Rule-based inbox triage. | Owns the cheap-inbox-tidying buyer. |
| **Shortwave** ($25/mo) | AI-native Gmail client. | Direct competitor for "AI knows your inbox." |
| **Reclaim / Motion / Clockwise / Blockit** | AI calendar scheduling. | Calendar-only specialists. |
| **Granola** ($1.5B valuation, March 2026) | Meeting notes → enterprise AI memory ("Spaces"), MCP server for agents. | The "memory infrastructure" play we are not making. |

### Personal knowledge / second-brain tools (the wiki-shaped competitors)

| Product | Position | Notes |
|---|---|---|
| **Mem 2.0** | "AI thought partner" with email-forward capture, voice mode, agentic Chrome extension, semantic search. | Direct competitor for "second brain that knows you." |
| **Reflect** | Networked-thought notes + GPT-4 + Whisper. Bidirectional links. | Direct competitor for "personal wiki + AI." |
| **Mind Cortex / Atomic / Novyx Vault / Second Brain I/O** | PARA-method second brain, local-first knowledge graph, AI-augmented vault. Several with email integration and MCP servers. | All pursuing the same wiki+AI+email shape. |

### Memory-first sovereignty agents (closest to our core technical claim)

| Product | Position | Notes |
|---|---|---|
| **Hermes Agent** (Nous Research, open-source) | "Closed learning loop" with synthesized skill docs + Honcho dialectic user modeling. | The most architecturally ambitious memory story. Validation pending — only a few weeks of real use. |
| **ZHAR / Aion / Aipa / Thoth / Cognitia AI Memory Layer** | Local-first / on-device / BYOK personal AIs with persistent encrypted memory, knowledge graphs, version history. | A whole tier of products competing on **data sovereignty** as their identity. |

### Direct Karpathy LLM Wiki implementations

The pattern that powers our wiki half ([karpathy-llm-wiki-post.md](./karpathy-llm-wiki-post.md), April 2026) **already has 4+ open-source instantiations**, including the Obsidian plugin **green-dalii/obsidian-llm-wiki** (v1.7.0, May 2026) and `llm-wiki-karpathy` / `Karpathy-LLM-Wiki-Stack` / `llm-wiki-template`. These ship the ingest / query / lint loop for any agent (Cursor, Claude Code, Gemini CLI). The "LLM maintains a markdown wiki for you" claim is no longer novel — even the *workflow vocabulary* is being standardized by other people.

### Human EAs as the substitute we are implicitly priced against

**Athena** ($3,000/mo for a vetted human EA, AI-augmented), **Magic** (weekly billing, screened humans). Buyers who already pay for these are the *least* likely to swap to an unproven AI EA — the hard part of EA work is judgment and trust, both of which a $50/mo software can't credibly claim.

---

## What this map tells us

1. **There is no white space called "AI personal assistant."** Anthropic, Microsoft, Google, Meta-via-Manus, OpenClaw's open-source ecosystem, and 30+ startups are all there. Every general claim ("knows you," "drafts in your voice," "briefs you before meetings") is now interchangeable feature copy.
2. **The wiki idea has commoditized in twelve months.** Karpathy's pattern has Obsidian plugins. Mem 2.0 and Reflect own the consumer mindshare for "AI second brain." Granola owns the enterprise variant.
3. **The "AI EA" SKU is a graveyard.** April/Consul/Precedent/Arahi/Dume/Ayari/Lindy/Manus/Poke/Lucien/Senchal/Zo/MrDelegate/Personal AI all fit the same shape and are racing to the bottom on price ($15–200/mo) while bigtech bundles the same capability into existing subscriptions.
4. **What remains contested:** trust, sovereignty, and the *combination* of indexed-mail-corpus + maintained-wiki + agent. Most competitors do **one** of those three; very few do all three locally; almost none address the *graph between brains*.

---

## Critical examination of the executive-assistant framing

The user-proposed framing: position Braintunnel as an **executive assistant** — drafts briefings for meetings, plans travel, finds and manages documents, takes notes, spans personal and work life.

### Where the framing is right

- **The job-to-be-done is real and recognizable.** Buyers know what an EA does. There is established willingness to pay (Athena $36K/yr, Lindy $600/yr).
- **It maps cleanly onto our agent surface.** Calendar CRUD, email drafts, ripmail search, wiki notes, web search, YouTube transcripts — all of this *is* EA work.
- **It honors the wiki + ripmail mechanism.** Briefings, travel, doc-finding all benefit from a maintained wiki and an indexed mail corpus more than from a fresh-every-session chat.
- **Personal+work span matches our breadth.** Most AI EAs are work-only; we already index personal mail and calendars.

### Where the framing is wrong

- **It picks a fight we cannot win on distribution.** Anthropic ships Cowork to every Claude subscriber. Microsoft and Google bundle the equivalent into Office and Workspace. Lindy has 400K users and a Series B. Our wedge is too narrow to dent any of these on EA-feature checklists.
- **It collapses our differentiator into commodity feature claims.** The moment we say "AI EA," buyers ask "vs Lindy?" and our answer becomes a feature comparison where the hidden mechanism (lifetime owned mail corpus + maintained wiki + brain-to-brain) is invisible.
- **The buyers most likely to trust an AI EA are the buyers being most aggressively contested.** Founders and execs who already delegate are heavily marketed-to and have low patience for unproven tools.
- **The buyers most aligned with our trust story are the ones who already refuse generic AI EAs.** Lawyers, family offices, financial advisors, clergy, healthcare professionals — they would never put client mail in Lindy. They would also not buy a product called "AI executive assistant" unless it specifically promised data sovereignty.
- **Pricing pressure is brutal.** AI EA is racing to $20–50/mo while incumbents bundle. We cannot fund the security/trust posture that justifies our architecture out of $50/mo SaaS revenue.
- **EA framing leaves brain-to-brain stranded.** The whole network-effect moat ([STRATEGY.md](./STRATEGY.md), [IDEA-wiki-sharing-collaborators.md](./ideas/IDEA-wiki-sharing-collaborators.md)) makes no sense in an EA frame, because EAs do not coordinate with each other across organizational boundaries.

**Verdict:** The EA *job* is a useful internal lens for prioritizing features (briefings, travel, drafts, calendar, doc-finding). The EA *label* is a category trap that makes the marketing fight unwinnable and renders our actual moat invisible. Use the JTBD; refuse the label.

---

## Five alternative framings, evaluated

Each is stated as a positioning sentence, then assessed on (1) fit with our actual technology, (2) competitive density, (3) buyer clarity, (4) compatibility with brain-to-brain.

### A. "Personal IDE for your inbox + life-knowledge"

> Braintunnel is the environment where you and an LLM **work with your own data** — your mail, your calendar, your notes — the way Cursor is the environment where you and an LLM work with your codebase.

- **Fit:** Excellent. Karpathy's "Obsidian is the IDE; the LLM is the programmer; the wiki is the codebase" maps directly onto our architecture. Power users are the natural buyer for a tool, not a service.
- **Density:** Lower than EA. Mem/Reflect/Obsidian-plus-LLM-plugin compete here, but most are notes-only; few combine the indexed mail corpus.
- **Clarity:** Strong for technical buyers, weaker for non-technical.
- **Brain-to-brain:** Compatible — IDEs share repos; brains share scoped subtrees.

### B. "Local-first life corpus / personal data infrastructure"

> Braintunnel is the local-first index of your life — your mail, calendar, files, messages — with an LLM front-end that gets smarter the longer you keep it.

- **Fit:** Excellent. ripmail + wiki + sources[] *is* a personal data infrastructure.
- **Density:** Low — only sovereignty-led memory agents (ZHAR/Aion/Aipa/Thoth) play here, and none own the mail corpus.
- **Clarity:** Weak. "Data infrastructure" sells to engineers, not to the SMBs in [STRATEGY.md](./STRATEGY.md).
- **Brain-to-brain:** Excellent — corpora link, like email federation.

### C. "AI assistant for trust-sensitive professionals"

> Braintunnel runs on your machine. Lawyers, financial advisors, family offices, doctors, clergy, executive coaches — anyone whose mail is privileged — can use an AI assistant without putting client data in someone else's cloud.

- **Fit:** Strong. Local-first architecture, single-tenant isolation, embedded TLS, optional Tauri-bundle, end-to-end-encryption narrative ([SECURITY.md](./SECURITY.md), [STRATEGY.md](./STRATEGY.md) §Trust) are *only* differentiators in this lane.
- **Density:** Sparse. Most AI EAs are explicitly cloud-only with weak data-handling stories. Direct competitors are mostly older non-AI tools (e.g., Clio for lawyers).
- **Clarity:** Strong — the buyer's first objection (data) is our first answer.
- **Brain-to-brain:** Compatible — peer review across firms is exactly the use case.
- **Risk:** Vertical sales cycles are long. Compliance (HIPAA, SOC 2, attorney-client work product) is real engineering, not a slogan.

### D. "Founder's brain" / AI Chief of Staff for solo + small-team operators

> Braintunnel is the brain a founder builds before they can hire a Chief of Staff — your mail, calendar, decisions, and people in one place that the AI can act on.

- **Fit:** Reasonable. Wiki + ripmail + agent maps to morning briefings, follow-ups, decision logs, vendor tracking.
- **Density:** Crowded — Lucien, Senchal, Zo, MrDelegate, Personal AI all here.
- **Clarity:** Strong. Founders know what a CoS does.
- **Brain-to-brain:** Modest — co-founder pair is a clean two-brain example, but the network thesis needs more nodes than two.

### E. "The system your EA uses, not the EA itself"

> Braintunnel is the personal knowledge base and AI workspace that an executive and their human EA share — so handoffs, briefings, travel, and follow-ups live in one place that the AI maintains and both humans can edit.

- **Fit:** Strong, but novel. Plays with brain-to-brain (the EA's brain has scoped access to the executive's brain).
- **Density:** Empty. Athena + Magic + AI EAs all assume *one* user; none address the EA-as-second-user.
- **Clarity:** Requires storytelling — but anchors against $3K/mo Athena pricing rather than $50/mo AI EA pricing.
- **Brain-to-brain:** This *is* brain-to-brain Phase 2.
- **Risk:** Two-sided sale (executive + EA both must adopt). Smallest immediate market.

---

## Recommendation

A defensible posture, in priority order:

1. **Reject "AI executive assistant" as a category label.** Use the EA JTBD internally for feature prioritization (briefings, travel, drafts, doc-finding) but do not market under that category. The label is a graveyard.
2. **Reframe around mechanism.** Lead with the combination that no single competitor matches: *indexed lifetime mail corpus + LLM-maintained wiki + agent that uses both*, on a *local-first single-tenant* runtime with *brain-to-brain* as the network shape. This is what is actually different about us.
3. **Keep STRATEGY.md's instinct (small businesses, 5–50)** but **narrow further** to either:
   - **Framing C — trust-sensitive professional segments**: lawyers, family offices, financial advisors, executive coaches, healthcare practitioners. Buyer's first objection (data sovereignty) is our first answer. Adjacent revenue ceiling is high; sales cycles long.
   - **Framing A — power-user tool ("Cursor for your inbox+life-knowledge")**: developers, researchers, consultants, journalists, technical founders. Buyer is willing to pay for tools, not services. Aligned with our local-first / desktop-bundle path.
   - **Framing E — augment human EAs**: optional medium-term wedge once Phase-2 read-write brain-to-brain ships. Anchors against $3K/mo, not $50/mo.
4. **Keep brain-to-brain visible in positioning even before it is mature.** It is the only differentiator with no symmetric competitor and is the long-term moat. Do not let EA-style framing bury it.
5. **Defer mass-market AI-assistant fight indefinitely.** Anthropic, Microsoft, Google, Meta will own that lane via distribution; nothing we do at our scale changes that.

The hardest pair to choose between is **A** (power-user tool) and **C** (trust-sensitive professional). They differ on whether we lead with "tool you wield" or "service you trust" — which in turn implies different onboarding, different sales motions, different security investment, and different pricing. That choice is a separate decision.

---

## Open questions

1. **Tool vs service.** Are we an Obsidian-shaped *tool* (user does the work; LLM is the programmer) or an Athena-shaped *service* (user delegates; LLM acts)? Our tech can support either; our pricing and onboarding cannot support both.
2. **Wedge segment.** Among lawyers, financial advisors, family offices, executive coaches, technical founders, consultants — which has the *fastest path* from sign-up to felt value with our current product?
3. **Name.** Does **Braintunnel** read right for the chosen segment? It tests well as a power-user / techie name; uncertain for trust-sensitive professional verticals where naming carries gravitas.
4. **When does brain-to-brain become a wedge, not just a moat?** Today it is positioned as a long-term defensibility story ([STRATEGY.md](./STRATEGY.md)). Framing E says it is the *primary* product. That is a real choice, not a footnote.
5. **What does "AI EA JTBD without the AI EA label" actually look like in copy?** Worth a separate exercise on landing-page language and onboarding voice once a segment is chosen.
6. **What does "trust-sensitive" cost us in engineering?** True compliance (HIPAA, SOC 2 Type II, attorney–client work product) is not free; if Framing C wins, [SECURITY.md](./SECURITY.md) needs a multi-quarter roadmap, not just a posture.

---

## What this document does not decide

- The final positioning. This is analysis to support that decision, not a substitute for it.
- Pricing — depends on the chosen framing.
- Whether to change [STRATEGY.md](./STRATEGY.md) or [VISION.md](./VISION.md). Those stay authoritative until a positioning decision lands.
- Whether to keep the **Braintunnel** name.

---

## References

- Internal: [VISION.md](./VISION.md) · [STRATEGY.md](./STRATEGY.md) · [the-wiki-question.md](./the-wiki-question.md) · [karpathy-llm-wiki-post.md](./karpathy-llm-wiki-post.md) · [product/personal-wiki.md](./product/personal-wiki.md) · [PRODUCTIZATION.md](./PRODUCTIZATION.md) · [SECURITY.md](./SECURITY.md)
- Architecture: [integrations.md](./architecture/integrations.md) · [per-tenant-storage-defense.md](./architecture/per-tenant-storage-defense.md) · [wiki-read-vs-read-email.md](./architecture/wiki-read-vs-read-email.md) · [deployment-models.md](./architecture/deployment-models.md) · [wiki-sharing.md](./architecture/wiki-sharing.md)
- Brain-to-brain sequencing: [IDEA-wiki-sharing-collaborators.md](./ideas/IDEA-wiki-sharing-collaborators.md) · [OPP-064 archived spec](./opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md) · [OPP-091 archived spec](./opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md)
- External landscape (May 2026):
  - Sawinyh, *The 2026 AI Agent Landscape* — https://sawinyh.com/blog/ai-agent-landscape-2026
  - Ry Walker, *Personal Agents Platforms Compared* — https://rywalker.com/research/personal-agents-platforms
  - Anthropic, *Claude Cowork* — https://claude.com/cowork
  - Lindy — https://www.lindy.ai/
  - Manus — covered in Sawinyh / Walker surveys
  - Poke — https://poke.com/
  - April — https://www.tryapril.com/
  - Mem 2.0 — https://get.mem.ai/blog/introducing-mem-2-0
  - Reflect — https://www.reflect.app/
  - Granola — covered in industry coverage of $1.5B raise (March 2026)
  - Hermes Agent / Honcho — https://hermes-agent.org/
  - Athena (human EA) — https://www.athena.com/

---

*This document is intentionally analytical. It frames the choice rather than making it; the decision belongs in [STRATEGY.md](./STRATEGY.md) once a direction is chosen.*
