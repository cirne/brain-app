# OPP-014: Onboarding — Suggested Local Folders (Documents / Desktop)

## Vision

First-run onboarding already plans to bootstrap the wiki from email and an accepted user profile ([OPP-006](./OPP-006-email-bootstrap-onboarding.md)). **Add a short, optional step that proposes concrete local directories**—without asking the user to browse or type paths—so the first wiki is grounded in **mail + the files that already live on their machine**.

The moment should feel obvious: *“These folders look useful. Add them?”* The user toggles what they want; Brain registers those paths as sources, then continues to wiki seeding. No blank “add a source” form on day one.

## Agent-specific presentation (not only default chat)

As we add more specialized agents, the **main** lever is usually the **system prompt**—but some flows also need **different UI**: related components, layout, or how much “internals” we show. We should not assume every agent run looks like the **default chat window** with full streaming tool detail.

**Today:** Config already carries small behavioral hints (for example whether a given agent **opens documents by default**). That is a narrow slice of “this agent is not generic chat.”

**Direction:** Generalize so an agent **kind** or **run profile** can declare **how it presents while it executes**—progress-first, calmer copy, less tool noise—while still using the same agent runtime and SSE plumbing underneath. Onboarding, profiling, and seeding agents are good candidates: easier to see **progress**, less wall-of-tools, without hiding that something real is happening.

**Coupling to this opportunity:** Implementing folder recommendations should **ship alongside** (or immediately follow) this **presentation abstraction**: same agent execution path, **different shell** for the run, and a clear **handoff** when the run completes.

- **During execution:** The folder-recommendation agent uses that non-default presentation (status / phases / summarized activity—not necessarily raw tool transcripts front and center).
- **After execution:** That presentation transitions to—or is replaced by—the **directory selection** UI (toggles, paths, reasons from JSON, skip/confirm). The chat transcript can remain available in a secondary affordance if we want power users to expand it.

Without this, we risk bolting a bespoke screen only for this step while the next specialized agent still forces default chat; the generalization keeps “special agent, special UI” a **repeatable** pattern.

**Downstream:** A different class of runs—**scheduled or triggered wiki maintenance** (not user chat)—reuses the same infrastructure with other triggers and usually **lighter** UI; see **[OPP-015: Wiki Background / Maintenance Agents](./OPP-015-wiki-background-maintenance-agents.md)**.

## Core prompt (concept)

Run **early**, ideally **after the profile is built and accepted** (so the recommender can use `wiki/me.md` and email context as hints) and **before** the heavy “build the wiki” seeding pass—so indexed notes and PDFs can inform seeding, not only post-hoc search.

Example agent instruction (shape, not final copy):

> Use the files tool: search `~/Documents` and `~/Desktop`. Recommend up to **10 folders** that would help Brain understand the user’s projects, notes, and work—prioritize directories that look like active work, knowledge bases, or recurring topics. Return a **strict JSON document** (paths, short labels, one-line rationale each). Do not index yet; only recommend.

The actual tool surface may be `/files` search or equivalent local filesystem tooling exposed to the onboarding agent; the contract is **structured output**, not prose buried in chat.

## JSON contract (sketch)

The onboarding agent returns something stable enough for the wizard to render checkboxes:

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

**Requirements:**

- Paths must be **absolute**, normalized, and validated server-side before registration.
- Cap at **10** suggestions; merge duplicates; drop unreadable paths.
- Optional: **confidence** or **category** (`work`, `personal`, `archive`) for UI sorting—only if it stays cheap to produce.

## Wizard UX

1. **Transition copy** (after profile accept): *“We can also pull in folders from your Mac so the wiki isn’t only email. Here are some that look helpful.”* The recommender agent runs under the **agent-specific presentation** described above; when it finishes, **that same flow** surfaces the picker (not a disconnected modal unless we deliberately choose minimal chrome).
2. **List** each suggestion with label + one-line reason + full path (collapsible or secondary text).
3. **Per-row toggle** (default: all on, or conservative default—product decision).
4. **Primary actions:** **Add selected** / **Skip** (skip = proceed with email-only sources for this step).
5. **Then:** register **sources** for selected directories (see [ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md) — unified mail + local files as first-class indexed sources), kick off or enqueue crawl/index as appropriate, and **only then** run the seeding agent (“build the wiki”) so both mail and chosen folders are available.

Reuse patterns from OPP-006: same onboarding route, persisted state machine, resumability if the user closes the tab.

## Why this slot in the flow

| Placement | Benefit |
| -------- | ------- |
| After profile | Agent can align suggestions with stated projects, employers, and names from `wiki/me.md`. |
| Before wiki seeding | Seeding can reference file-backed context, not only ripmail search results. |
| Optional + toggles | Preserves trust; user stays in control of what leaves “browse my disk” territory. |

## Permissions and platform

- **macOS / native:** Folder access may require explicit consent (sandbox, security-scoped bookmarks, or Tauri capabilities). The step should fail gracefully: if the agent cannot read a path, omit it or mark it unavailable.
- **Non-Mac or no fs access:** Hide the step or degrade to “Add folders later” without blocking onboarding.

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Noisy suggestions (`Downloads`, huge archives) | Prompt ranks down generic names; cap size; exclude known junk patterns. |
| Sensitive paths (finance, health) | Same opt-in pattern as OPP-006’s sensitive-data story; never auto-add without confirmation. |
| Slow first index | Run crawl in background; seeding can start with “ready enough” threshold or mail-first + files catch-up. |
| LLM hallucinated paths | Validate every path exists and is a directory before showing or registering. |

## Success criteria

- User can complete onboarding **without** touching this step (skip path).
- Users who opt in report **fewer** “Brain doesn’t know about my notes” moments in the first week.
- Median time added to onboarding: **under 2 minutes** of wall time (agent + UI), excluding background indexing.

## Relation to other work

- **[OPP-006: Email-Bootstrap Onboarding](./OPP-006-email-bootstrap-onboarding.md)** — Parent flow; this step extends “zero data entry” with disk hints. OPP-006’s **Two-agent design** section cross-references here for **profiling and seeding** as examples of future **agent-specific presentation** (not only default chat).
- **[OPP-015: Wiki Background / Maintenance Agents](./OPP-015-wiki-background-maintenance-agents.md)** — Downstream: cron-style and triggered agents that tend the wiki; benefits from the same agent/run/presentation generalization this doc motivates.
- **[ripmail OPP-051: Unified Sources](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)** — Implementation home for directory sources and search.
- **[OPP-007: Native Mac App (archived)](./archive/OPP-007-native-mac-app.md)** — Deeper filesystem integration may make this step more reliable on the packaged app.

## Open questions

1. **Default toggles:** all on vs. all off vs. “high confidence only”?
2. **Windows/Linux:** same `Documents`/`Desktop` convention or XDG-style defaults?
3. **Re-run:** Should “Re-run onboarding” offer **only** folder suggestions again without redoing email?
4. **Cost:** Is a dedicated short agent run acceptable vs. folding recommendations into the profiling agent (likely worse separation of concerns)?
5. **Presentation API:** What do we key off—agent id, onboarding step id, a `presentation: 'onboarding' | 'chat' | …` field—and how does it compose with existing “open documents by default” (and similar) config?
