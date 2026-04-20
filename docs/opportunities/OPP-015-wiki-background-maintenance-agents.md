# OPP-015: Wiki Background / Maintenance Agents

## Vision

Beyond chat and onboarding, Brain can run **specialized agents on a schedule or trigger** whose job is to **tend the wiki**: monitor drift, **lint** and fix where safe, **add** missing scaffold pages, **reorganize** or cross-link, and generally **build it out** over time. These runs are **not user-initiated** (though a manual “run maintenance now” control may exist). They share **most of the same runtime, tools, and code paths** as interactive agents but need **different presentation** (if any): digest, activity log, notification surface, or settings—not a default streaming chat window.

This is a **separate opportunity** from folder onboarding ([OPP-014](./OPP-014-onboarding-local-folder-suggestions.md)), but it is **downstream of OPP-014’s thrust**: first-class **agent kinds**, **run profiles**, and **presentation** so we are not special-casing every flow in ad hoc UI.

## Relationship to OPP-014 (upstream)

[OPP-014](./OPP-014-onboarding-local-folder-suggestions.md) pushes **generalized agent infrastructure**: same execution stack, configurable **how** an agent presents while running and **what** happens when it finishes (e.g. handoff to structured UI). Background maintenance agents reuse that work:

- **Shared:** Tooling, SSE or batch execution, logging, safety rails, wiki path validation ([OPP-004](./OPP-004-wiki-aware-agent.md)).
- **Different:** Trigger model (cron, changelog thresholds, file watchers), **no** conversational loop by default, **minimal or alternate** UI chrome.

Until OPP-014-style generalization exists, background agents risk duplicating one-off plumbing; sequencing **OPP-014 (or equivalent infra) first** keeps maintenance agents from painting us into a corner.

## Relationship to OPP-004

[OPP-004](./OPP-004-wiki-aware-agent.md) already sketches **background lint** (cron, changelog-driven checks, structured log). OPP-015 is the **umbrella**: not only lint, but **multiple** maintenance “modes” or agents—cleanup passes, orphan resolution, suggested new pages from inbox/sources, light reorganization—implemented as **first-class scheduled/triggered agents** rather than a grab bag of unrelated scripts.

Concrete lint behavior can remain aligned with OPP-004; OPP-015 names the **product and architecture** for “wiki gardeners” as a family.

## Examples of maintenance jobs

| Job | Rough trigger | Notes |
| --- | --- | --- |
| Lint / link health | Daily or after N changelog events | Overlaps OPP-004 background lint |
| Orphan / index hygiene | Weekly | Update `_index.md`, suggest merges |
| Scaffold gaps | After profiling or mail sync | “You talk about X often; no `people/x` page” — user-facing **discovery + review** first: [OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md) |
| Stale `updated:` / metadata | Scheduled | Optional; avoid noisy edits |
| Light reorg | Rare + explicit policy | High trust; may need human review queue |

Not all of these ship at once; the opportunity is the **pattern**, not a single monolithic cron.

## Triggers (sketch)

- **Time-based:** Cron-equivalent (e.g. daily lint).
- **Event-based:** Changelog size, new mail index completion, new sources added.
- **User:** “Run wiki maintenance” in settings (same agent code path as scheduled run).

## Presentation

- **Not** the main chat transcript by default: **Brain Hub** (`/hub`) accessible via the top-nav widget.
- **Brain Hub** shows wiki stats, recent docs, and **Background Agents** list (replaces bottom status bar).
- **Drill-down:** Clicking an active agent in Brain Hub expands its detail panel (timeline, logs).
- **Silent** runs still surface issues in the wiki browser ([OPP-004](./OPP-004-wiki-aware-agent.md) optional UI badges).
- **Overlap with OPP-014:** Interactive onboarding wants progress-first, less tool noise; background agents may want **even less**—or only post-run digest—depending on autonomy level.

## Safety and trust

- **Autonomy tiers:** Suggest-only vs auto-apply safe fixes vs queue for review (especially moves/deletes).
- **Audit trail:** Structured changelog entries for every maintenance run (`type: maintenance`, agent id, scope)—aligned with OPP-004 structured log direction.
- **Rate limits:** Avoid thrash; batch edits; respect user “do not auto-edit” flags if we add them.

## Non-goals (initially)

- Replacing the **main** agent for user-directed work.
- Fully autonomous restructuring without guardrails or review paths where stakes are high.

## Open questions

1. **Single “maintenance agent”** with sub-prompts vs **several named agents** (lint-bot, scaffold-bot) sharing a scheduler?
2. **Where does the scheduler live?** App server cron, OS launchd, in-process timer, external worker?
3. **Notification:** In-app only vs optional system notification when review is needed?
4. **Overlap with email/indexing pipelines:** One orchestrator vs separate triggers per subsystem?

## Success criteria

- Maintenance runs **do not** require opening chat.
- New maintenance behaviors mostly add **prompt + schedule + policy**, not a new bespoke stack.
- Wiki quality metrics (broken links, orphans) improve measurably without user micromanagement.

## Relation to other work

- **[OPP-033: Wiki compounding + Karpathy alignment](./OPP-033-wiki-compounding-karpathy-alignment.md)** — User-facing **Your Wiki** in Hub: **Cleaning up** phase maps to maintenance/lint here; orchestrator runs enrich → cleanup in laps; pause/resume semantics.
- **[OPP-014: Onboarding — Suggested Local Folders](./OPP-014-onboarding-local-folder-suggestions.md)** — Upstream agent infrastructure and presentation generalization.
- **[OPP-004: Wiki-Aware Agent](./OPP-004-wiki-aware-agent.md)** — Structured changelog, background lint, path validation; concrete building blocks for maintenance agents.
- **[OPP-025: Wiki Hygiene Coalescing and Authoring Expectations](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)** — Change-driven, coalesced post-edit hygiene (settle timer, mutex, rerun if dirty); split between interactive authoring scope and background reconciliation. Complements time-based triggers above.
- **[OPP-026: Knowledge Expansion Discovery UI](./OPP-026-knowledge-expansion-discovery-ui.md)** — User-reviewed **expansion** suggestions (JSON + evidence from wiki + sources); complement to hygiene; approved items feed write jobs here.
- **[OPP-006: Email-Bootstrap Onboarding](./OPP-006-email-bootstrap-onboarding.md)** — Interactive onboarding agents contrast with non-interactive maintenance agents (same family, different triggers and UI).
