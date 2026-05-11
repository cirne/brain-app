# Archived: OPP-095 — Wiki first-draft bootstrap

**Status: Archived (2026-05-12).** Removed from the active backlog (shipped or no longer pursued).

**Stub:** [../OPP-095-wiki-first-draft-bootstrap.md](../OPP-095-wiki-first-draft-bootstrap.md)

---

## Original spec (historical)

### OPP-095: Wiki first-draft bootstrap — mail-informed skeleton, then maintenance loop

**Status:** Planned  
**Related:** [archived OPP-067](./archive/OPP-067-wiki-buildout-agent-no-new-pages.md) (implemented deepen-only enrich; **narrowed** by this OPP — bootstrap may `write`), [OPP-094](../OPP-094-holistic-onboarding-background-task-orchestration.md) (orchestration + wiki kick timing), [OPP-054](../OPP-054-guided-onboarding-agent.md) (`me.md` / interview), [OPP-068](../OPP-068-wiki-template-user-profiles.md) (vault presets), [OPP-077](../OPP-077-who-smart-address-book.md) (address book / identity signals — optional inputs), [onboarding-state-machine.md](../../architecture/onboarding-state-machine.md)

---

## Problem

After onboarding, many vaults have **almost no pages** while the mail index already has **thousands of messages**. The current **Your Wiki** loop assumes a **non-empty deepen queue** (recent edits + thin `people/` / `projects/` / `topics/`). **[Archived OPP-067](./archive/OPP-067-wiki-buildout-agent-no-new-pages.md)** correctly avoids speculative page sprawl **in steady state**, but combined with an early **wiki supervisor start** ([indexed gate](../OPP-094-holistic-onboarding-background-task-orchestration.md)) it produces **low-value laps** (re-editing the same one or two files).

Users still want a **first useful wiki shape**: who matters, what they are working on, upcoming travel, and a light sense of themes — **without** requiring many chat turns first.

---

## Goal

Introduce a **single bounded “first draft” phase** that creates an initial wiki **surface area** from **mail (and optional calendar)** signals, then hand off to the **existing maintenance** pattern (enrich + cleanup laps, chat-created stubs).

**First draft should include (typical outputs):**

| Area | Intent | Default artifact shape |
|------|--------|-------------------------|
| **Important people** | Draft **`people/*.md`** stubs for humans the account holder **actually** communicates with or repeatedly **mentions / CCs** — not everyone who sent mail in 30d | Compact stub (role line, relationship hint, optional identifiers section); **defer** deep biography to later laps |
| **Projects / active interests** | What the user is **spending attention on** (subject lines, recurring threads, sent mail) | **`projects/*.md`** or a small set of **`topics/*.md`** — see **Topics** below |
| **Upcoming travel** | Trips with dates (itineraries, “checking in”, calendar if available) | One **`travel/upcoming.md`** (or dated files under `travel/`) — **low page count** |
| **Topics / themes** | “Key interests” without exploding into dozens of pages | Prefer **one** summary file (e.g. **`topics/interests.md`** or a section in **`index.md`**) unless the model finds **clear, recurring** themes worth splitting |

**Topics:** Full per-theme `topics/foo.md` files are **optional** for v1; default to **conservative** aggregation so the hub is not noisy.

---

## Design principles

### 1. Recency vs importance (people)

Explicitly instruct the bootstrap agent:

- **Recent contact alone is weak evidence of “importance.”** Newsletters, billing, and one-off vendors can dominate recent mail.
- Prefer **patterns**: **bidirectional** threads, **repeated** correspondents over the backfill window, user **sent** mail, **CC** / **about** mentions, substantive replies vs pure broadcasts.
- **Deprioritize** obvious non-persons: `noreply@`, high-volume marketing patterns, mailing lists when detectable (future: ripmail / rules hints).
- **Cap** the number of `people/` pages (see **Budgets**); tie-break with composite score (frequency × recency decay × “human likelihood”), not inbox sort order.

### 2. One orchestrated bootstrap run

- **One agent invocation** (multi-tool inside the run is fine): draft pages + refresh **`index.md`** / hub links.
- **Persist completion:** e.g. `chats/onboarding/wiki-bootstrap.json` (or reuse `onboardingDataDir()`) with `{ status, completedAt, version }` so we **never** auto-run twice unless operator reset / new vault.

### 3. Then: maintenance loop only

After bootstrap **success**:

- **YourWiki supervisor** / enrich laps use the **archived OPP-067** deepen-only contract: **deepen and fix**, **chat** remains the primary path for **new** question-scoped pages (unless we later widen maintenance deliberately).
- **First lap** after bootstrap should see a **non-empty manifest** and meaningful **thin** / **recent** queue — eliminating empty churn.

### 4. Gating (align with state machine)

**Trigger candidates** (pick one default in implementation; document the choice):

- **`onboarding` → `done`** **and** indexed mail ≥ **N** (reuse or tune `WIKI_BUILDOUT_MIN_MESSAGES`), **and** bootstrap not yet completed; **or**
- **Stricter:** `done` **and** phase-1 **30d** corpus “usable” (same as today’s interview gate philosophy).

**Do not** start the **continuous** wiki supervisor until **bootstrap completed** **or** explicitly skipped (power user / empty mail edge case).

This **updates** [OPP-094](../OPP-094-holistic-onboarding-background-task-orchestration.md) milestone semantics: wiki auto-start attaches to **“bootstrap done → maintenance on”**, not “indexed only.”

---

## Relationship to archived OPP-067 (does not fully replace)

| Phase | Who creates **new** `people/` / `projects/` / … paths? |
|-------|--------------------------------------------------------|
| **First draft (this OPP)** | **Bootstrap agent** — allowed bounded **`write`** |
| **Ongoing laps** | Prefer **edit**-only deepen per archived OPP-067; **chat** creates new narrow pages |

Add a short **terminology** split in prompts or code: `wikiBootstrapAgent` vs `wikiBuildoutAgent` / enrich runner.

---

## Server / product deliverables

1. **Bootstrap runner** — parallel to `runEnrichInvocation`: build context (manifest, `me.md`, optional **server-computed** mail stats / candidate list if we pre-aggregate to save tokens), prompt, single agent run, record outputs in `wiki-edits.jsonl`, set completion flag.
2. **Supervisor ordering** — `ensureYourWikiRunning` only after bootstrap complete (or skip path).
3. **Hub / background status** — show “Drafting your wiki…” vs “Enriching…” so users understand the two phases.
4. **Tests** — bootstrap completion idempotency; supervisor blocked until bootstrap; optional eval fixture (corpus → expected cap on `people/` count).

---

## Budgets and safety (defaults — tune in implementation)

- **Max new `people/` pages:** e.g. **12–20** (final number TBD).
- **Max `projects/` (+ optional `topics/` split):** e.g. **5–10** combined.
- **Travel:** **1–3** artifacts (single file preferred).
- **Token / tool budget:** optional hard lap limits to prevent runaway search.

---

## Open questions

1. **Calendar:** Use ripmail calendar JSON in bootstrap for **travel** when OAuth calendar exists ([OPP-070](../OPP-070-full-calendar-read-write-agent-surface.md)) — default **on** if available?
2. **Hosted vs desktop:** Same bootstrap on both; any **reduced** mode without calendar?
3. **Re-bootstrap:** Only on explicit “Reset wiki draft” / new tenant, or offer a **rare** manual “Regenerate skeleton” with merge policy?
4. **OPP-077 / `who`:** Inject ranked **`ripmail who`** or contact hints as **optional** structured input to reduce LLM thrash?

---

## Acceptance criteria

- [ ] New users with substantial indexed mail get a **visible first wiki** (people + projects/interests + travel summary) **without** requiring chat turns.
- [ ] **Continuous** Your Wiki laps **do not** run meaninglessly on an almost empty vault; they follow bootstrap **or** a documented skip.
- [ ] People list reflects **importance heuristics**, not raw recency; **caps** prevent page explosion.
- [ ] **Archived OPP-067** steady-state behavior preserved for post-bootstrap laps (deepen / chat creates).
- [ ] [onboarding-state-machine.md](../../architecture/onboarding-state-machine.md) / [OPP-094](../OPP-094-holistic-onboarding-background-task-orchestration.md) updated when implementation lands (milestones + kick order).
