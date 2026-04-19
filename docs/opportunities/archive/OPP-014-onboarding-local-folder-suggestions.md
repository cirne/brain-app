# Archived: OPP-014 (Onboarding — Local Folder Suggestions)

**Status: Deprioritized — archived.** The core onboarding (email → profile → wiki seeding) is shipped and delivers the "zero data entry" promise without this step. Adding folder suggestions is a meaningful improvement but not blocking. Archived to keep the active queue lean; reopen when local folder sources are a real user complaint or when ripmail OPP-051 (unified sources) lands and makes registration cheap.

**What was deferred:**
- Agent-driven folder recommendations from `~/Documents` and `~/Desktop` presented as toggle list
- JSON contract from onboarding agent → wizard UI
- Integration with ripmail OPP-051 source registration
- Agent-specific presentation model (progress-first UI vs raw tool streaming)

**Dependencies if reopened:**
- ripmail OPP-051 (unified sources + local directory indexing) for the actual source registration
- OPP-015 (wiki background agents) for the "index in background, seed uses result" pattern
- The agent-specific presentation abstraction described here is a useful generalization for any non-default-chat agent run

---

# OPP-014: Onboarding — Suggested Local Folders (Documents / Desktop)

## Vision

First-run onboarding already plans to bootstrap the wiki from email and an accepted user profile ([OPP-006](./OPP-006-email-bootstrap-onboarding.md)). **Add a short, optional step that proposes concrete local directories**—without asking the user to browse or type paths—so the first wiki is grounded in **mail + the files that already live on their machine**.

The moment should feel obvious: *"These folders look useful. Add them?"* The user toggles what they want; Brain registers those paths as sources, then continues to wiki seeding. No blank "add a source" form on day one.

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

1. After profile accept: *"We can also pull in folders from your Mac..."*
2. List each suggestion with label + one-line reason + full path
3. Per-row toggle (default: all on, or conservative)
4. **Add selected** / **Skip**
5. Register sources → enqueue crawl/index → run seeding agent

## Why this slot in the flow

| Placement | Benefit |
| -------- | ------- |
| After profile | Agent aligns suggestions with `wiki/me.md` context |
| Before wiki seeding | Seeding can reference file-backed context, not only ripmail |
| Optional + toggles | Preserves trust; user controls what Brain indexes |

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Noisy suggestions (`Downloads`, archives) | Prompt ranks down generic names; cap size |
| Sensitive paths (finance, health) | Opt-in pattern; never auto-add without confirmation |
| Slow first index | Background crawl; seeding starts with "ready enough" threshold |
| LLM hallucinated paths | Validate every path exists before showing or registering |

## Related

- **[OPP-006: Email-Bootstrap Onboarding](./OPP-006-email-bootstrap-onboarding.md)** — Parent flow
- **[OPP-015: Wiki Background / Maintenance Agents](./OPP-015-wiki-background-maintenance-agents.md)** — Same agent/presentation generalization
- **[ripmail OPP-051: Unified Sources](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)** — Implementation home for directory sources
