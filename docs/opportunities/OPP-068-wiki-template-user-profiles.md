# OPP-068 — Wiki template: user-profile starter directories

**Status:** future  
**Depends on:** [OPP-054](OPP-054-guided-onboarding-agent.md) (onboarding agent), [OPP-060](OPP-060-starter-wiki-templates-and-agent-authoring.md) (starter wiki templates)

---

## Problem

The default wiki scaffold is generic. A salesperson's mental model looks nothing like a student's or an executive's — they think in terms of **Prospects / Deals / Customers**, not in terms of **Courses / Study / Notes** or **Board / Strategy / Reports**. A one-size wiki feels foreign to most users on day one.

## Idea

Define a small set of **user-profile presets**, each with a curated set of top-level wiki directories (and optional stub pages) tuned to that persona's workflow. The default profile stays minimal and broadly applicable.

### Example profiles

| Profile | Suggested top-level folders |
|---|---|
| **Default** | People, Projects, Notes, Reference |
| **Sales professional** | Prospects, Opportunities, Customers, Deals, Competitors, Notes |
| **Student** | Courses, Study, Assignments, Research, Notes |
| **Software developer** | Projects, Architecture, Runbooks, Research, Notes |
| **Executive / founder** | Strategy, Board, OKRs, People, Operations, Notes |
| **Knowledge worker** | Projects, Research, Reading, Notes, Reference |

Profiles are additive — the system still creates the user's wiki however they organically grow it. These are just a better first scaffold.

## LLM-assisted profile detection during onboarding

As part of the [guided onboarding agent (OPP-054)](OPP-054-guided-onboarding-agent.md), after the user connects email we can:

1. Sample a handful of recent email subjects/senders (no bodies needed for privacy).
2. Ask the LLM: *"Based on these signals, which of these profiles best fits this user: [list]?"*
3. Pre-select the best match and let the user confirm or switch.

This keeps onboarding personal without requiring the user to self-identify upfront. The confidence bar should be low — if ambiguous, default to **Knowledge worker** (neutral).

## Why it matters

- Makes the wiki feel **immediately relevant** rather than blank.
- Reduces the "what do I put here?" friction in the first session.
- Sets up good folder structure for the buildout agent ([archived OPP-067](archive/OPP-067-wiki-buildout-agent-no-new-pages.md)) to populate — it will have semantically sensible containers to fill.
- Cheap to extend: adding a new profile is just a JSON/YAML definition + a few stub Markdown templates.

## Constraints / notes

- **Core use case first.** This is a polish / onboarding-quality win, not a blocker. Ship only after the default wiki experience is solid.
- Profile detection is **a hint, not a hard categorization** — do not let it constrain what the user can do.
- Keep the profile list small (≤8) to avoid decision paralysis. Merge similar ones.
- Profiles should be versioned / addable over time without breaking existing vaults.
