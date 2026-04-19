# Wiki-first memory vs external managed memory (Honcho) — not for now

**Status:** Recorded — **not pursuing** (revisit if product priorities change)  
**Scope:** Agent context and long-term memory strategy (chat, wiki, optional third-party memory services)  
**See also:** [ARCHITECTURE.md](../ARCHITECTURE.md), [agent-chat.md](./agent-chat.md), [data-and-sync.md](./data-and-sync.md)

---

## Context

Coding agents already scale to large codebases by **assembling context on demand**: search, grep, reading files or slices until the model has enough to act. The working assumption is that the **repository is the source of truth** and is kept coherent (tests, review, refactors) so stale or contradictory material is limited.

Brain’s **markdown wiki with hyperlinks** is the analogous surface: the agent uses tools to find and read what matters, synthesize, and write back. That model is **intentionally aligned** with how coding agents use repos—transparent, user-owned, and portable.

Separately, products such as **[Honcho](https://honcho.dev/)** (Plastic Labs) offer **managed agent memory**: continual ingestion, reasoning over history, layered recall (more detail for recent or salient material, less for the deep past), and fast curated `context()`-style retrieval. That addresses a different problem than “store everything in markdown”: it automates **compaction, salience, and interpretation** over conversational and event history without requiring the user to maintain notes.

---

## Tradeoffs we weighed

| Dimension | Wiki-first (current direction) | Managed memory (e.g. Honcho) |
|-----------|-------------------------------|------------------------------|
| **Source of truth** | User-visible files; edits are explicit | Opaque store + service reasoning |
| **Hygiene** | Like a codebase: stale pages can **confuse** the model unless the vault is curated (“linted,” reorganized, archived) | Service aims to **decay** or summarize old material with less manual pruning |
| **Cost & dependency** | Local files + existing LLM calls | Additional vendor API, ingestion/reasoning pricing |
| **Local-first / privacy** | Data stays on disk under user control | Hosted service (or self-host ops) for the memory layer |
| **Fit with Brain** | Matches repo-like tool use already in the stack | Could be a **strategic** addition later, not a small toggle |

Honcho is **not** dismissed as technically weak; it is a plausible **strategic bet** if we ever prioritize automatic conversational memory and layered historical reasoning over a strictly vault-centric workflow.

---

## Decision

**Stay wiki-first** as the primary long-term memory and context strategy. We are **not** integrating Honcho (or an equivalent managed memory product) **at this time**.

Rationale in short:

1. **Architectural coherence** — Brain’s design centers on files, tools, and user-controlled knowledge; adding a parallel memory cloud would split “what the assistant knows” unless we invested heavily in reconciliation.
2. **Cost and complexity** — Managed memory is an ongoing bill and operational dependency; it must earn its place against improving vault hygiene, prompts, and optional **local** summarization or archival workflows.
3. **Deliberate “not yet”** — If priorities shift (e.g. cross-session chat memory becomes the main product problem), we can **re-evaluate** Honcho or self-hosted alternatives with explicit requirements.

---

## Consequences

- Product and engineering discussions should assume **wiki + tools + mail/index** remain the main durable context unless this note is superseded.
- **Stale wiki content** remains a **known risk** (analogous to untested or dead code); mitigations are editorial (archiving, linking conventions, periodic review), not replaced by an external memory layer for now.
- A future ADR would be needed to adopt managed memory: data flow, privacy, offline/desktop behavior, and how vault truth relates to service memory.

---

## Research note (April 2026)

Public docs and pricing were reviewed ([honcho.dev](https://honcho.dev/), [docs.honcho.dev](https://docs.honcho.dev/)). No prototype was run in-repo for this decision.
