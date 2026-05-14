# Strategy

**Status:** Initial thoughts — hypotheses, not commitments. Treat as a central place we refine over time.

This document is the **single source of truth** for go-to-market, competitive positioning, and moats. **[VISION.md](VISION.md)** stays the narrative of *what Braintunnel is* and why personalization matters at the human level. Open analysis of which **job-to-be-done** and **category label** to adopt — including a critical reading of the "AI executive assistant" framing against the May-2026 competitive landscape — lives in **[the-product-question.md](the-product-question.md)** (companion to [the-wiki-question.md](the-wiki-question.md)).

---

## Competitive landscape

**Large platform vendors** — Microsoft, Anthropic, OpenAI, Google, Apple, Meta, etc. — have distribution, budgets, models, and product suites adjacent to generalized “assistant” workflows. Delegating AI life-work to someone else’s omnibus product puts us in lanes they intend to occupy.

**Many small competitors** — the cost of shipping new software is near zero relative to historic norms. Features and demos can be copied quickly. We should assume **imitators multiply** and optimize for differentiation that survives that dynamic, not surface-level novelty alone.

---

## Where to focus

Avoid competing head-on in the **mass-market generalized assistant** category; incumbents and platform-owned products (including **Claude Cowork**–style team workspaces from model vendors) will be expected to lead there.

Prefer **narrow markets and segments** first:

- **Small businesses**, roughly **5–50 employees** (initial guess), whose leaders are **aware of AI** (e.g., have heard of ChatGPT) but are **not** already committed to one platform cowork product and **need a credible place to start** with life-and-work personalization (email, calendar, wiki grounding).
- **Vertical focus** remains an option inside that segment — narrower bets before broader ones — if it sharpens positioning and repeatable onboarding.
- **Graduation**, if it works: grow into **mid-size** contexts (examples: **100- or ~500-person** organizations) once playbooks prove out — not Day 1 breadth.

*[PRODUCTIZATION.md](PRODUCTIZATION.md) covers concrete multi-tenant/engineering gaps; strategy here is segment choice.*

---

## Moats

We need **defensibility from below** (startups/clones) and **realistic expectations from above** (platforms).

### From platforms (above)

**Depth in a wedge that is strategically small for them.** If the addressable wedge is deliberate and narrow, generalized platform roadmaps pay less reward for cloning our exact playbook. Winning means **meaningful differentiation and delight** in that wedge, not parity on every assistant feature.

### From imitators (below)

**(1) Network**

Braintunnels that **coordinate with each other** create a graph of relationships and delegated trust. Larger network → harder for a bottom-up clone to replicate the same relational fabric; switching would mean rebuilding **connections and scopes**, not just exporting files.

**(2) Trust (security posture)**

Users bring **among the most sensitive possible data**: mail, calendars, wiki, eventually messages, docs — effectively a curated **lifetime brain**. Competitive advantage includes being the **provider people choose because they refuse to normalize another party reading all of it**. That implies relentless security engineering, transparency, optional **hardware / local-first** narratives where true, and over time evaluating **everything that makes plaintext on our infra unnecessary** — including contemplating **strong end-to-end encryption** models where operators never see plaintext. **Telegram** (optional E2EE “secret chats”) and **WhatsApp** (defaults on message E2EE) are reference points for how consumer trust aligns with cryptography story — product tradeoffs apply and must be spelled out separately.

Operational controls and today's threat model belong in **[SECURITY.md](SECURITY.md)**.

---

## Brain-to-brain and the trust network

The product manifestation of **network + trust** is **brain-to-brain**: bilateral trust edges, explicit scopes, human-in-the-loop where it matters — a **trust network**, not a social feed. Economic value scales with **who your brain may query on your behalf** and what you authorize, **not follower counts**.

**Email as analogy:** federation, identity-bearing addresses, and **value that grows with who else participates**. Brain-to-brain aims for similarly **network-shaped** upside with **much higher-bandwidth coordination** delegated to agents — while keeping sovereignty visible.

**Current sequencing (B2B):** **[architecture/braintunnel-b2b-chat.md](architecture/braintunnel-b2b-chat.md)** — explicit **grants** (`brain_query_grants`), Hub **Brain access**, and **chat-native Tunnels** (`/api/chat/b2b`: cold query, send, owner **review / approve** before the asker sees the reply). Policy + trust model: [brain-to-brain-access-policy.md](architecture/brain-to-brain-access-policy.md), product direction: **[ideas/IDEA-brain-query-delegation.md](ideas/IDEA-brain-query-delegation.md)**. **Unified brief / notification** polish across mail, calendar, and collaboration remains [ideas/IDEA-anticipatory-assistant-brief.md](ideas/IDEA-anticipatory-assistant-brief.md). **Earlier mail-based experiment (historical):** [archived OPP-106](opportunities/archive/OPP-106-email-first-cross-brain-collaboration.md). **Historical wiki-share + `wikis/` shipped work:** **[IDEA-wiki-sharing-collaborators (archived)](ideas/archive/IDEA-wiki-sharing-collaborators.md)** — **[archived OPP-064](opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md)**; **`wikis/`** layout **[OPP-091](opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md)**.

---

## Related docs


| Doc                                                                                  | Purpose                                                                 |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [VISION.md](VISION.md)                                                               | What the product feels like and why personalization compounding matters |
| [the-product-question.md](the-product-question.md)                                   | Open analysis: narrow JTBD, category-label traps (AI EA), and alternative framings against the 2026 landscape |
| [the-wiki-question.md](the-wiki-question.md)                                         | Open analysis: is the maintained wiki worth its cost vs ripmail-only?   |
| [PRODUCTIZATION.md](PRODUCTIZATION.md)                                               | Blockers/tradeoffs to multi-user productization                         |
| [SECURITY.md](SECURITY.md)                                                           | Security architecture and risk register                                 |
| [ideas/IDEA-brain-query-delegation.md](ideas/IDEA-brain-query-delegation.md) | Brain-query delegation (B2B) — active product direction                                          |
| [ideas/IDEA-anticipatory-assistant-brief.md](ideas/IDEA-anticipatory-assistant-brief.md) | **Brief + notification/inbox** — prioritized cross-surface items; **Braintunnel B2B** approve/decline ships in chat ([architecture/braintunnel-b2b-chat.md](architecture/braintunnel-b2b-chat.md)); fuller “executive brief” UX remains backlog |
| [ideas/archive/IDEA-wiki-sharing-collaborators.md](ideas/archive/IDEA-wiki-sharing-collaborators.md) | Brain-to-brain collaboration — **archived** (superseded by B2B brain-query); shipped wiki-share + sequencing history |
