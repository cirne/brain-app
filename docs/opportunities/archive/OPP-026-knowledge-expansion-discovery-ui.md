# Archived: OPP-026 — Knowledge expansion discovery UI

**Status: Deprioritized — archived 2026-04-21.** Not scheduling a dedicated discovery flow; expansion remains chat- and supervisor-driven.

---

# OPP-026: Knowledge Expansion Discovery UI (Structured Suggestions + Review)

## Vision

**Hygiene** tightens and reconciles what already exists ([OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)). **Expansion** asks: *where should the wiki go next—wider or deeper—and where can Brain add the most value?* This opportunity is the **expansion** counterpart: not a cron-only background job, but a **dedicated experience** (like onboarding’s specialized shell) where Brain **anticipates** what matters, **shows its work** with evidence, and lets the user **curate** before any expensive write pass.

The emotional beat: *Brain looked across my wiki and my sources and proposed the next five moves—and I could veto one for privacy before it ran.* After approval, expansion **runs like other background brain work**: visible in a **status strip** with drill-down, not a wall of chat by default (section 4).

## Relationship to other opportunities

| Opportunity | Role here |
| ----------- | --------- |
| [OPP-014](./OPP-014-onboarding-local-folder-suggestions.md) | **Precedent:** agent-specific presentation, **structured JSON handoff** to a wizard (toggles, paths), not prose-only chat. Expansion discovery reuses that **pattern** with a different prompt and payload. |
| [OPP-015](./OPP-015-wiki-background-maintenance-agents.md) | **Sister track:** maintenance agents include “scaffold gaps” and similar; this OPP is **user-facing discovery** with review. Actual **execution** of approved items may still be a background or chat-triggered agent ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md)). |
| [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md) | **Complement:** hygiene = cheap, coalesced, often; expansion = **expensive**, **user-gated** or scheduled—this UI is one way to **choose** what expands. |
| [OPP-006](./OPP-006-email-bootstrap-onboarding.md) | First-run wiki bootstrap; expansion discovery is **ongoing** “what’s next?” after the initial scaffold. |

## Problem

Chat-first flows for “what should I add to my wiki next?” bury the answer in **streaming prose**, are hard to **parse programmatically**, and don’t give a crisp **review + exclude** step before work starts. A **research / expansion** mode deserves:

- A **non-default UI** (progress-first, card list, evidence drill-down)—same infrastructure idea as [OPP-014](./OPP-014-onboarding-local-folder-suggestions.md).
- A **stable machine output**: an **array** of suggested initiatives, not only a wall of text.

## Proposal

### 1. Purpose-built run (not generic chat)

Trigger from a clear entry point (e.g. **“Expand wiki”**, **“Discover gaps”**, or a section under Settings / wiki chrome—exact placement TBD). The run uses the **same agent runtime and tools** as chat (wiki grep/read, `search_index` / `read_mail_message` / `read_indexed_file` over ripmail-backed mail and indexed files, etc.) but:

- **System prompt** asks for **prioritized expansion opportunities**: go **wider** (new areas) or **deeper** (existing topics thin on the ground).
- **Server or contract layer** prefers a **final JSON document** as the **primary artifact** (see below), with optional short human-readable summary for the shell.

This mirrors onboarding’s split: **specialized presentation** + **structured handoff** ([OPP-014](./OPP-014-onboarding-local-folder-suggestions.md)).

### 2. JSON payload (sketch)

A single top-level object with an **array** of suggestions. Each item describes **one** expansion initiative—person, project, topic, or other category we support in the UI.

```json
{
  "generatedAt": "2026-04-17T12:00:00Z",
  "suggestions": [
    {
      "id": "sug-01",
      "kind": "person",
      "title": "Alex Morgan",
      "summary": "Frequent correspondent; thin wiki coverage.",
      "direction": "deeper",
      "rationale": "Many threads in last 90 days; only mentioned on projects/acme.md.",
      "evidence": [
        { "type": "email", "ref": "<message-id-or-stable-id>", "excerpt": "…" },
        { "type": "wiki", "path": "projects/acme.md", "excerpt": "…" }
      ],
      "suggestedActions": ["create people/alex-morgan.md", "link from projects/acme.md"]
    }
  ]
}
```

**Notes:**

- **`kind`** — loose enum (`person`, `project`, `topic`, …) for rendering and routing.
- **`evidence`** — enough for the UI to show **why** Brain picked this; refs must map to **open** in app (email detail, wiki path, file path per existing tools).
- **`id`** — stable for toggles and “run approved” batching; server may generate if the model omits.

Exact schema evolves; the point is **array + evidence + typed kind**, not chat-only markdown.

### 3. Review UI

- Render **cards** (or rows): title, one-line summary, **direction** (wider vs deeper), **evidence chips** (click to open source).
- Per row: **include** / **exclude** (e.g. “Don’t expand this”—privacy, sensitivity, or “not important”).
- **Bulk actions:** “Run selected” kicks off the **write** phase (background job or dedicated agent run); excluded IDs are never sent.

This is the **anticipatory** moment: Brain shows **importance** grounded in **real refs**, not vague confidence.

### 4. Execution after approval (phase two — background-shaped UX)

**Phase one** is JSON-first discovery + review (sections 2–3): the user sees structured suggestions and evidence, then approves a subset.

**Phase two** starts when the user confirms (e.g. “Run selected”). The **approved slice of the JSON** (plus stable context like wiki root and source availability) is **compiled into an execution prompt**—not a second JSON review step. The model run that **writes the wiki** is ordinary agent execution: same tools, scoped instructions (“deepen these N initiatives; respect exclusions; cite sources”), **batching** as needed (one run vs chunked jobs—implementation detail).

**How it should feel:** expansion execution is a **background process**, not something that occupies the main chat transcript by default. Same class of presentation as other **long-running brain work** (hygiene, seeding): the user can keep using the app while work proceeds.

**Status bar (app chrome):**

- **Baseline:** a compact **wiki summary** (doc count) always visible in the **Brain Hub widget** in the top nav—typical “status strip” material so the brain feels **alive** and legible at a glance.
- **When work is active:** if the **hygiene** agent and/or the **expansion** agent is running, the widget shows an **active pulse dot** and label.
- **Click:** opens **Brain Hub** (`/hub`) for the selected task: progress, phases, what the agent is doing, and—crucially—**artifacts**: pages created or updated, paths discovered, links fixed, etc. The user can **inspect** those documents from this view (open in wiki browser, etc.).

**Visualization:** each background job may have its **own** custom visualization (expansion vs hygiene need not look identical), but they should feel **consistent in role**: background task making the wiki better, not a chat thread. **Seeding / onboarding** agent runs are a reasonable **visual precedent** ([OPP-006](./OPP-006-email-bootstrap-onboarding.md)): similar “long run, structured progress, inspect output” energy even if layout differs. **BackgroundAgentPanel** is the shared component for this in Brain Hub.

**Safety and infra:**

- **Approved** work is enqueued; execution overlaps [OPP-015](./OPP-015-wiki-background-maintenance-agents.md)-style triggers and must respect **mutex** / sync when writing the wiki ([OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md), [OPP-024](./OPP-024-split-brain-data-synced-wiki-local-ripmail.md)).
- **Rejected** items can be remembered (optional “never suggest X” list) to avoid nagging—product decision.

### 5. Why JSON-first (phase one) before the execution prompt (phase two)

- **Review UI** stays stable while discovery prompts iterate: render from **schema**, not from parsing chat prose.
- **Testing** can assert payloads and approval → prompt **compilation** without running full writes.
- **Cost control:** one structured “planning” pass; the user filters **before** multi-page authoring burns tokens.
- **Clean handoff:** approval yields a **deterministic input** to phase two—the execution prompt is **derived from** approved JSON + policy, so the background writer does not re-litigate what was already curated.

Phase two does **not** need to return JSON to the user for the default path; it needs **reliable progress + inspectable outputs** in the status/detail UI described in section 4.

## Non-goals (initially)

- Replacing **interactive** chat for ad-hoc “write a page about X.”
- Fully automated expansion **without** review (that remains a separate policy under [OPP-015](./OPP-015-wiki-background-maintenance-agents.md)).
- Perfect **completeness scores** for the whole wiki (optional later; not required for v1).

## Open questions

1. **Entry point:** Wiki sidebar, Chat command, Settings, or first-class nav item?
2. **Refresh cadence:** On-demand only vs optional “suggest weekly” digest?
3. **Schema ownership:** Hard-coded TypeScript types vs JSON Schema for agent validation?
4. **Model failures:** If the model returns invalid JSON, retry with repair prompt vs fall back to prose + manual copy?
5. **Calendar / iMessage** ([OPP-003](./OPP-003-iMessage-integration.md)) as additional evidence types when available?
6. **Shared status bar:** Single spec for wiki summary + hygiene + expansion indicators ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md), [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)) vs ship expansion first and generalize?

## Success criteria

- Users can **scan** proposals and **exclude** items **before** any wiki writes—especially for **privacy-sensitive** topics.
- The experience feels **anticipatory** (Brain shows **why** each item matters) without requiring the user to craft a prompt from scratch.
- The feature **reuses** the OPP-014 pattern: **specialized shell** + **structured output** + **same** agent stack underneath.
- **Phase two** feels like **background work**: execution runs off the main chat default; **status bar** shows wiki health plus active jobs; **click-through** gives progress and **inspectable** pages/docs (aligned with seeding-style long runs, [OPP-006](./OPP-006-email-bootstrap-onboarding.md)).

## Relation to other work

- **[OPP-014: Onboarding — Suggested Local Folders](./OPP-014-onboarding-local-folder-suggestions.md)** — Same **handoff** shape; different domain (folders vs expansion initiatives).
- **[OPP-015: Wiki Background / Maintenance Agents](./OPP-015-wiki-background-maintenance-agents.md)** — Execution and scheduling; OPP-026 is **discovery + consent** upstream of some of those jobs.
- **[OPP-025: Wiki Hygiene Coalescing](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)** — Hygiene vs expansion split; coalesced hygiene may run **after** approved expansion writes.
