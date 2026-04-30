# OPP-067: Wiki buildout agent — deepen only, no new page creation

**Status:** Planned — implements [OPP-066](./OPP-066-chat-first-wiki-organic-growth-experiment.md) Milestone A.  
**Related:** [OPP-066](./OPP-066-chat-first-wiki-organic-growth-experiment.md) (chat-first wiki strategy), [OPP-062](./OPP-062-post-turn-wiki-touch-up-agent.md) (post-turn cleanup), [OPP-065](./OPP-065-wiki-eval-llm-as-judge.md) (eval harness)

---

## Problem

The wiki buildout agent (`wikiBuildoutAgent.ts` / `wiki-buildout/system.hbs`) currently treats **page creation** and **page deepening** as equal responsibilities. On each lap it may:

- Write new pages for any entity it finds enough mail signal for
- Also deepen and refresh existing pages

Under the OPP-066 split, this is the wrong job assignment. The chat assistant is now the **page creator** — it creates a narrow, question-scoped page with a `## Chat capture` stub whenever it does substantial email research. The buildout agent's role is to **deepen and enrich those existing pages**, not to independently discover and mint new ones.

Running two agents that both create pages introduces:
- Duplicate pages for the same entity (chat creates `people/jane.md`, buildout later creates a second thin stub)
- Wasted token spend discovering entities the user has never asked about
- Speculative pages the user may never need (violates the email-once / amortized synthesis model)

## Goal

**The buildout agent should never call `write` to create a page that does not already exist.** Its job is:

1. **Deepen existing pages** — take a chat-created stub and expand it with additional mail research, template alignment, and relationship coverage
2. **Refresh stale content** — update claims that newer email contradicts
3. **Fix structural issues** — broken wikilinks, missing Contact/Identifiers sections, template misalignment
4. **Do NOT** create new pages for entities not yet in the vault

## Input signals (what to work on)

The buildout agent should prioritize work based on:

1. **`var/wiki-edits.jsonl` tail** — pages recently written or edited by chat; these are the freshest stubs
2. **`## Chat capture` sections** — marker that a page was created from chat and is waiting for enrichment
3. **Thin-page heuristics** — pages under a word/section threshold that could be expanded with mail research
4. **"New since last lap"** — pages added since the previous buildout run

The agent should **not** scan the full inbox speculatively for entities that don't yet have pages.

## Implementation changes

### `wiki-buildout/system.hbs`

- Remove or rephrase language that allows `write` for new entities: *"Create `write` when mail gives enough recurring signal"* → replace with explicit **read-only** framing for new-entity creation
- Add a clear directive: **"Do not `write` new pages. Use `edit` only. The chat agent is responsible for page creation."**
- Update the task section to emphasize: start from the **injected vault manifest** or **`wiki-edits.jsonl` tail**; identify pages to deepen; do not look for entities not on the list
- Keep `edit` for: deepening thin pages, fixing wikilinks, adding Contact/Identifiers, refreshing stale claims

### `wikiBuildoutAgent.ts` / `wikiExpansionRunner.ts`

- Inject a **tail of `wiki-edits.jsonl`** (or a list of recently-created paths) into the buildout agent's user message so it has a concrete work queue rather than scanning from scratch
- Consider a **thin-page detector** pass before each lap: read the vault manifest, filter for pages under N words or missing key template sections, add those to the work queue
- Cap the lap: max pages to deepen, max mail searches per lap (already exists in some form; ensure it applies)

### Eligibility guard (optional, stronger enforcement)

If we want a hard guarantee, the server could intercept `write` calls from the buildout agent and reject any path not already present on disk — failing loudly so the prompt can be fixed rather than silently skipping.

## What the assistant agent owns (unchanged)

The chat assistant remains the **only path for new page creation**:

- Writes narrow, question-scoped pages during a chat turn when it does substantial email research
- Adds `## Chat capture` to signal that the page is a stub awaiting enrichment
- Does not try to "finish the hub" in one chat turn — that's the buildout agent's job

## Acceptance criteria

- The buildout agent prompt explicitly states it does **not** create new pages
- Buildout agent laps consume `wiki-edits.jsonl` tail or a thin-page list as the primary work queue
- No duplicate pages for entities that already have chat-created stubs
- Existing eval harness (wiki-v1) continues to pass; optionally extend with a test asserting the buildout agent only edits existing paths

## Open questions

1. **Thin-page threshold:** What word count / section count makes a page eligible for a deepening pass?
2. **Lap ordering:** Should the agent sort by recency of `wiki-edits.jsonl` entry, or by thinness?
3. **First-run behavior:** On a brand-new vault with no chat history, the buildout agent has nothing to work on. Is this acceptable? (Yes — the user just hasn't asked any questions yet. The supervisor should idle until chat creates the first pages.)
4. **Template alignment — resolved (2026-04-30):** The buildout agent now has **`read`**, **`grep`**, and **`find`** tools (landed in `main` as part of OPP-066 Milestone A). It can read existing pages and grep for structure before editing. No longer a blocker.
