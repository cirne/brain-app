# OPP-027: Wiki Nav Indicator and Activity Surface

## Vision

Replace the bottom status bar with a **first-class top-nav indicator** that represents wiki state at a glance and opens a dedicated **wiki activity surface** — a full-width view that serves as the home for background agent progress, wiki health, and the entry point for user-initiated wiki expansion. The indicator is always present; what it communicates varies by system state.

## Problem

The current UI has grown incrementally and is drifting toward unnecessary complexity:

- A **bottom status bar** appears only when a wiki-expansion agent is running. Bottom bars are a desktop/native pattern from the 1990s. They eat mobile viewport, feel out of place in a web app, and are invisible when nothing is running — so the wiki's state (healthy, building, stale) is never legible unless you happen to be watching.
- A **sync button** in the top nav implies the user needs to manage data freshness manually. If sync is automatic (cron + on-app-focus), the button is redundant noise.
- Background agent progress is **only visible if you know to look** — there is no ambient signal that anything is happening.
- There is **no entry point** for intentionally expanding the wiki after onboarding completes.
- The **left sidebar** conflates recent chat history with recently viewed docs and emails. It is useful but does not need to grow further.

The result: the UI is accumulating affordances without a coherent information architecture. Users can't develop a mental model of what Brain is doing or how to direct it.

## Proposed solution

### 1. Wiki state indicator in the top nav

A compact, always-visible **wiki indicator** lives in the top nav — the single canonical signal for wiki state. It replaces the sync button and the bottom status bar entirely.

**Visual states:**

| System state | Indicator appearance |
| --- | --- |
| Wiki healthy, nothing running | `📄 42` — icon + page count, static |
| Background agent running | `📄 42 ⟳` — animated spinner alongside count |
| Agent paused or error | Subtle badge or muted color shift |
| Wiki empty / just created | Icon alone (no count yet) |

The page count gives an immediate sense of Brain's knowledge depth. Users learn to glance at it the way they glance at a battery indicator — low ambient cost, high ambient value.

**Behavior:** Clicking the indicator at any time navigates to the **wiki activity surface** (see below). If the user is already inside that surface (e.g. viewing an agent detail), clicking the indicator returns to the surface root — it acts as a section tab, not a toggle.

### 2. Wiki activity surface (the hub)

Clicking the indicator opens a **full-width view** that replaces the main chat area. This is a first-class navigation destination, not a modal or popover. The user's current chat is preserved and resumed when they navigate back.

The surface adapts its content to system state:

**When nothing is running (wiki established):**
- Page count, last-built date, last-synced timestamp
- Prominent **"Build out your wiki →"** call to action
- Short list of recently created or updated pages (optional, for orientation)

**When a background agent is running:**
- One or more agent rows showing label, status, page count, and last file touched
- Click a row → that agent's detail view fills the surface (same detail currently in `BackgroundAgentPanel`)
- Clicking the wiki indicator from within an agent detail returns to the surface root

**When wiki is new or sparse (post-onboarding):**
- "Build out your wiki" CTA is the primary content — prominent, not buried

### 3. "Build out your wiki" — chat-based expansion with inline review

The CTA initiates an **expansion flow** that runs inside a new chat, using existing agent infrastructure and inline widget rendering. The flow has two phases:

**Phase 1 — Discovery (interactive, user is present):**

The agent does a fast planning pass against the wiki and mail index, then renders an **inline checklist widget** (same pattern as the mailbox archive widget) listing 5–10 proposed pages. Each row shows the proposed page title and a one-line rationale — why Brain thinks this page matters based on evidence from email and existing wiki content.

The user can:
- Uncheck items they don't want
- Type additions ("also add one for my Acme consulting work")
- Ask the agent to explain or refine any item

This preview step is the point: it validates that Brain understands the user, surfaces gaps the user hadn't considered, and gives the user authorship over their own knowledge base. The agent is doing anticipatory work — showing importance grounded in real evidence — not silently writing pages the user will never notice.

**Phase 2 — Background execution:**

When the user approves the list ("looks good, go"), the agent confirms scope, acknowledges any custom additions, and begins building in the background. The wiki indicator in the top nav gains its animated state. The chat surface is free for other use. The wiki activity surface shows progress. When execution completes, the indicator returns to its static state with the updated page count.

This two-phase shape means:
- The user sees what's planned **before** tokens are spent on writing
- The "suggest more" moment is native to chat — a static form cannot do this
- The handoff from interactive review to background execution is natural and in one place

### 4. Sync model simplification

The explicit sync button in the top nav is removed. Mail, docs, and calendar sync on a short automatic cadence (cron + on-app-focus). The wiki activity surface shows "Last synced X min ago" as a low-key data point. A "Sync now" action may be retained inside the surface or settings for edge cases, but it is not prominent chrome.

## Navigation model

```
Top nav:  [sidebar]  [Brain]  [search]  ···  [wiki indicator]  [settings?]
                                                    ↕
                                         Wiki activity surface
                                         (full-width, replaces chat area)
                                              ↕ (click agent row)
                                         Agent detail view
                                         (click indicator → back to surface root)
```

The wiki indicator is a **section switch** — like Slack's Home tab or Linear's Inbox. Navigating into the section preserves the chat session; navigating back resumes it.

## What this removes

| Current element | Disposition |
| --- | --- |
| Bottom status bar (`StatusBar.svelte`) | **Removed.** State moves to top-nav indicator. |
| Top-nav sync button | **Removed.** Sync becomes automatic; "last synced" appears in the activity surface. |
| Top-nav expansion spinner (duplicate of status bar) | **Removed.** Indicator handles this. |
| `BackgroundAgentPanel` slide-over | **Retained but re-parented** — its detail content becomes a view inside the activity surface rather than a slide-over overlay. |

## Relation to other opportunities

- **[OPP-015](./OPP-015-wiki-background-maintenance-agents.md)** — Background maintenance agents surface their progress in this same activity surface. The indicator and surface are designed to accommodate multiple concurrent background jobs.
- **[OPP-026](./OPP-026-knowledge-expansion-discovery-ui.md)** — The "Build out your wiki" chat flow described here is Phase 1 of OPP-026 (JSON-first discovery + inline review), implemented inside the chat surface with an inline widget instead of a dedicated full-page review UI. Phase 2 (background execution + progress) is surfaced via this indicator and surface.
- **[OPP-021](./OPP-021-user-settings-page.md)** — Settings remains a separate entry point (bottom of left nav). The wiki activity surface is not settings — it is operational status and action entry.
- **[OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)** — Hygiene agent runs appear alongside expansion runs in the surface; same indicator state.

## Open questions

1. **Surface naming:** The indicator and surface have no user-visible product name yet. The indicator's content (page count + icon) may be self-explanatory enough that a label is unnecessary. Avoid naming it in code in a way that's hard to change.
2. **Chat preservation on section switch:** When the user clicks the wiki indicator mid-chat, the active chat session must be fully preserved and resumed on return. Router implementation must handle this cleanly before the pattern ships.
3. **Multiple concurrent agents:** If hygiene and expansion run simultaneously, the surface shows both rows. Indicator state should reflect "anything active" rather than a specific agent type.
4. **Empty wiki state:** A user who has just completed onboarding and whose expansion agent has not yet run will see a sparse indicator and surface. The CTA should be prominent without being pushy.
5. **Sync "now" escape hatch:** Does a power-user "force sync" action belong in the activity surface, in Settings, or nowhere? Decide before removing the sync button.
6. **Agent detail routing:** When navigating to an agent's detail from the surface, does the URL change (deep-linkable) or is it purely in-memory state? Consistent with the router model used for other overlays.

## Success criteria

- The bottom status bar is gone; no information is lost.
- A user can tell at a glance (from any screen) whether Brain is actively building their wiki.
- A user can initiate wiki expansion, review what the agent plans to build, curate the list, and approve — all without leaving the chat metaphor.
- Background execution progress is visible without occupying the main chat area.
- The top nav is simpler than it is today (sync button removed, status bar gone, one indicator added).
