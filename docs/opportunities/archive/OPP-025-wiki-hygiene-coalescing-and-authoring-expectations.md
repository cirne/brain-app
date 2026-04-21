# Archived: OPP-025 — Wiki hygiene coalescing

**Status: Deprioritized — archived 2026-04-21.** Hygiene behavior is folded into the live supervisor / agent prompts; a separate spec epic is not scheduled.

---

# OPP-025: Wiki Hygiene Coalescing and Authoring Expectations

## Vision

Brain’s wiki improves through **two complementary rhythms**:

1. **Expansion and discovery** — deeper coverage, new topics, scaffolding from mail/calendar/chat. **Expensive**; should run on a **modest schedule or strong signals**, not after every keystroke ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md)).

2. **Maintenance and hygiene** — link health, deduplication, tightening prose, single source of truth, fixing cross-references. **Cheaper** than expansion and should run **more often**, but only when there is **something to do**.

This document pins down **what we expect from the interactive assistant at authoring time** versus what we **defer** to hygiene, and specifies an **event-driven, coalesced** hygiene runner (debounce-like scheduling + mutex) so the wiki settles after agent or user edits **without** requiring a fixed cron for every pass.

## Relationship to other opportunities

| Opportunity | Role here |
| ----------- | --------- |
| [OPP-015](./OPP-015-wiki-background-maintenance-agents.md) | Umbrella for background agents, triggers, presentation; hygiene coalescing is one **trigger model** for maintenance-class work. |
| [OPP-004](./OPP-004-wiki-aware-agent.md) | Structured changelog, background lint, changelog-driven checks; coalesced hygiene should **consume the same change signals** (e.g. recent affected paths) and align with audit/logging. |
| [OPP-024](./OPP-024-split-brain-data-synced-wiki-local-ripmail.md) | If the wiki syncs via iCloud, **only one writer** should run mutating hygiene at a time—mutex/lease under `$BRAIN_HOME` applies here too. |
| [OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md) | **Expansion** side: structured “what to deepen or add next” with user review **before** big writes; complements hygiene’s reconcile-and-tighten loop. |

## Problem: authoring scope vs wiki-wide reconciliation

Today, doc-authoring guidance often bundles **write the page well** with **when you’re done, fix links and hygiene**. That is right for the **page under hand**. It becomes ambiguous when:

- The user asks for a **new focused document** about a topic that already has **a few paragraphs** in a **broader parent** page.
- The “right” end state is **one canonical page** plus a **short summary + link** in the parent—not two competing writeups.

**Open question in the user’s head:** Should the **same chat turn** (or the authoring skill) **dedupe the parent** and **edit every related file**, or is that **hygiene’s job**?

## Proposal: split responsibilities

### What the core assistant should do in-session (authoring expectations)

**For the document(s) it was asked to create or materially edit:**

- Follow the **local** quality bar: clear structure, correct wiki links for **citations and navigation it introduces**, and **explicit pointers** (e.g. “See [Topic](wiki:path/topic.md) for detail”) where split is intentional.
- If the task implies **splitting** content out of another page: perform the **minimum cross-edit** that keeps the user unconfused in **this** session—typically:
  - add the new page; and
  - replace or shorten the overlapping section in the parent with a **summary + link** to the new page (or add a “See also” if full replacement is risky without re-reading the parent).

**For broader “the whole wiki around this topic”:**

- **Do not** require a full wiki-wide dedupe pass in the same turn. That explodes **context, latency, token cost**, and failure modes (missed files, partial reads).
- **Do** record enough **structured intent** in changelog / edit metadata if we have it ([OPP-004](./OPP-004-wiki-aware-agent.md)): e.g. affected paths, “split from `parent.md`”, so hygiene can prioritize.

**Net:** the assistant is responsible for **correctness and coherence of the work it was asked to do**, including **obvious** sibling edits (parent stubbing when splitting). It is **not** responsible for **exhaustive** reconciliation of every related note unless the user asked for that scope.

### What coalesced hygiene is for

**Everything else** that benefits from **another pass after files have settled**:

- Link graph repair, orphan detection, duplicate-title or duplicate-paragraph heuristics.
- **Deduping** remnants across pages the author did not open.
- Terminology normalization (“single source of truth”) within a **neighborhood** of changed files (e.g. backlinks, same section of the tree).
- Optional: **light** LLM-assisted merge suggestions **queued** with evidence and diffs, not inline in every chat.

This matches the product goal: **hygiene runs often and cheaply**; **expansion** runs less often ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md)).

## Coalesced post-edit hygiene (“settle then sweep”)

**Intent:** Hygiene runs **when the wiki has changed**, not on a blind interval when nothing moved. Avoid redundant runs when idle. **Batch** bursts of edits (e.g. agent wrote five files) into **one** hygiene pass where possible.

### Behavior (conceptual)

1. **Dirty flag:** Any write to the wiki under management (user save, agent tool, import) sets **wiki dirty** and records **affected paths** (or relies on changelog since last hygiene).

2. **Settling delay:** After the **last** modification in a burst, start a **timer** (order of **~5 seconds**—tunable). If another modification lands before it fires, **reset** the timer. This is **coalescing**, not strict debounce: we care about **idle gaps**, not every keystroke.

3. **Mutex:** Before starting a mutating hygiene run, acquire a **lock/lease** (same family as multi-device / iCloud safety in [OPP-024](./OPP-024-split-brain-data-synced-wiki-local-ripmail.md)). If another process holds the lock, **skip or queue**—do not run two hygiene writers concurrently.

4. **Run hygiene:** Execute the **hygiene** job (deterministic checks + optional LLM steps per policy). Scope: **prefer** changelog-affected files + neighbors, not necessarily whole wiki every time ([OPP-004](./OPP-004-wiki-aware-agent.md) changelog-driven lint).

5. **Re-entrancy / churn:** If hygiene **itself** writes files (fixing links, deduping), that counts as new modifications:
   - **Do not** interrupt an in-flight hygiene run because something else changed mid-flight; let the current run finish.
   - When hygiene **completes**, if the wiki is **still dirty** (new user/agent edits occurred during the run, or hygiene’s own edits need a follow-up pass), **schedule another** coalesced run after the same settling delay (e.g. 5 seconds after completion).

6. **No-op fast path:** If **nothing** has changed since the **last successful hygiene** completion (and no pending dirty flag), **do not** run. This is “**don’t rerun if there have been no changes**” from the product discussion.

### Contrast with scheduled hygiene

- **Coalesced:** reactive to edits; keeps the wiki consistent **soon after** interactive work without requiring the user to ask.
- **Scheduled (e.g. nightly):** still useful for **expansion**, **full-tree** checks, or **cold** wikis where no recent edit triggered a pass; also a **backstop** if coalescing was skipped due to lock contention.

Both can coexist; **default emphasis** for **cheap** maintenance is **change-driven coalescing**; **expensive** passes stay **rare or scheduled**.

## UI and observability (light touch)

- Optional status: **“Tidying…”** or **“Wiki idle”** when coalesced hygiene is running or complete—aligned with [OPP-015](./OPP-015-wiki-background-maintenance-agents.md) “not main chat by default.”
- If hygiene is blocked on mutex: subtle **“Waiting for sync lock…”** only if user-visible delays matter; otherwise silent retry.

## Safety and trust

- **Autonomy tiers** unchanged from OPP-015: auto-apply safe fixes vs suggest vs review queue for destructive merges.
- **Evidence-first** hygiene for LLM steps: prefer **reading** affected pages over inventing facts; contradictions **flagged** rather than silently “resolved” when confidence is low.

## Open questions

1. **Exact settle time:** Is 5 seconds the right default for desktop local disk, vs slower sync folders (iCloud)? May need **adaptive** delay if we detect sync latency.
2. **Hygiene scope per pass:** Changelog-only neighborhood vs periodic full-tree link scan—how often is the full scan?
3. **Authoring skills:** Should `SKILL.md` templates **encode** the split (“local page + optional parent stub; defer wiki-wide dedupe to hygiene”) so behavior is consistent across models?
4. **Interaction with chat:** If the user is **still** streaming a follow-up, do we delay hygiene until **session idle**? (Could reduce contention; might delay hygiene too long—policy choice.)

## Success criteria

- After creating a **split-out** page, the wiki converges to **consistent** cross-links and **no long-term duplicate canon** without the user running a manual “lint everything” prompt.
- Hygiene does **not** run in a tight loop on an **idle** wiki; it **does** run after bursts of edits, **at most** one “wave” per settle window unless a second pass is **needed** due to churn.
- Authoring turns stay **focused**; token spend for **wiki-wide** reconciliation shifts to **hygiene**, where it can be **budgeted and scoped**.

## Relation to other work

- **[OPP-015: Wiki Background / Maintenance Agents](./OPP-015-wiki-background-maintenance-agents.md)** — Adds **coalesced change-driven** triggers alongside cron/event triggers.
- **[OPP-004: Wiki-Aware Agent](./OPP-004-wiki-aware-agent.md)** — Changelog and lint semantics feed **dirty detection** and **scoped** hygiene.
- **[OPP-024: Split Brain data — synced wiki vs local ripmail](./OPP-024-split-brain-data-synced-wiki-local-ripmail.md)** — Mutex/lease for hygiene writers when wiki is synced.
