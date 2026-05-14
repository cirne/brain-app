# Archived: OPP-014 — Knowledge expansion (local folders)

**Status: Deprioritized — archived 2026-04-21.** Covered in practice by [OPP-087](./OPP-087-unified-sources-mail-local-files-future-connectors.md) (unified sources / local dirs); a separate Brain Hub “expansion” initiative is not on the near-term roadmap.

---

# OPP-014: Knowledge Expansion — Suggested Local Folders (Documents / Desktop)

**Historical status:** Reopened / Active — 2026-04-19.
**Direction:** Kicked off from **Brain Hub**, not the initial onboarding flow.

## Vision

Instead of a mandatory onboarding step, **folder discovery is a "Knowledge Expansion" initiative launched from the Brain Hub.** The user can trigger it at any time to help Brain find more context on their machine.

The moment should feel like a proactive assistant: *"I can find more context in your local folders. Should I take a look?"* The user triggers the discovery; Brain proposes concrete directories—without asking the user to browse or type paths—and the user toggles what they want to index.

## Brain Hub Integration

1. **Entry Point:** A "Find more context" or "Add local folders" button in the **Data Sources** section of the Brain Hub (`/hub`).
2. **Trigger:** User clicks to start the discovery agent.
3. **Agent Run:** The discovery agent runs (using the specialized presentation model) to find candidate folders in `~/Documents` and `~/Desktop`.
4. **Handoff:** Agent returns a structured list of suggestions to a Hub-hosted wizard.
5. **Registration:** Selected folders are registered via `ripmail sources add` (OPP-087).

## Agent-specific presentation (not only default chat)

As we add more specialized agents, some flows need **different UI**: related components, layout, or how much "internals" we show. We should not assume every agent run looks like the **default chat window** with full streaming tool detail.

**Direction:** Generalize so an agent **kind** or **run profile** can declare **how it presents while it executes**—progress-first, calmer copy, less tool noise—while still using the same agent runtime and SSE plumbing underneath.

## Core prompt (concept)

> Use the files tool: search `~/Documents` and `~/Desktop`. Recommend up to **10 folders** that would help Brain understand the user's projects, notes, and work—prioritize directories that look like active work, knowledge bases, or recurring topics. Return a **strict JSON document** (paths, short labels, one-line rationale each). Do not index yet; only recommend.

## JSON contract (sketch)

```json
{
  "suggestedFolders": [
    {
      "path": "/Users/me/Documents/Projects/Gamaliel",
      "label": "Gamaliel",
      "reason": "Active repo-style project folder with README and notes"
    }
  ]
}
```

## Wizard UX

1. User triggers from Hub: *"Scanning for useful folders..."*
2. List each suggestion with label + one-line reason + full path
3. Per-row toggle (default: all on, or conservative)
4. **Add selected** / **Cancel**
5. Register sources → enqueue crawl/index → background notification when ready

## Why Brain Hub vs Onboarding

| Placement | Benefit |
| -------- | ------- |
| **Brain Hub** | Reduces onboarding friction; user can do it when they are ready to "expand" |
| **On-demand** | Can be re-run later as the user creates new projects |
| **Context-aware** | Agent can use the existing wiki/me.md to better rank suggestions |

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Noisy suggestions (`Downloads`, archives) | Prompt ranks down generic names; cap size |
| Sensitive paths (finance, health) | Opt-in pattern; never auto-add without confirmation |
| Slow first index | Background crawl; notification when first-pass index is ready |
| LLM hallucinated paths | Validate every path exists before showing or registering |

## Related

- **[OPP-021: User Settings (Brain Hub)](./OPP-021-user-settings-page.md)** — Host for the discovery flow
- **[OPP-015: Wiki Background / Maintenance Agents](./OPP-015-wiki-background-maintenance-agents.md)** — Same agent/presentation generalization
- **[OPP-087: Unified Sources](./OPP-087-unified-sources-mail-local-files-future-connectors.md)** — Implementation home for directory sources
