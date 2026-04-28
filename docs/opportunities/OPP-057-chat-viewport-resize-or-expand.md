# OPP-057: Agent chat — resizable transcript pane or grow with viewport

**Status:** Open  
**Tags:** `chat` · `layout` · `ux`  

**Related:** [OPP-049](OPP-049-global-ui-tailwind-refactor.md) (global Tailwind/layout consistency); pane split patterns in Hub / `Assistant`.

---

## One-line summary

Let users **drag-resize** the main text chat viewport (composer vs transcript proportions), or **automatically enlarge** the chat column when horizontal space exists so replies are not cramped on large displays.

---

## Problem

Today the transcript area can **feel unnecessarily small** on wide screens; refinement is constrained to scrolling within a fixed vertical split unless the Hub layout already expands the chat region.

---

## Proposed direction

- **Prefer** a **splitter / drag affordance** (or persisted width fraction) between chat and optional side/detail regions where the architecture already supports side panels.
- **Alternative / complement:** **`min()` / max-width** and flex growth so chat **consumes slack width** instead of preserving large empty gutters.
- Respect mobile: resizing may be desktop-only or behind a **`md:`** breakpoint.

---

## User feedback

- In-app issue **#12** (`2026-04-27`).
