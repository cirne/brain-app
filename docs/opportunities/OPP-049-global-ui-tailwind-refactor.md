# OPP-049: Global UI refactor — Tailwind-first stylesheet

**Status:** Proposed (long-running epic).

**Execution model:** Treat as a **dedicated branch** effort; use a **large, capable model** for breadth across the Svelte client (many files, style archaeology). **No rush**—optimize for **consistency and test coverage** over a single big bang.

## Summary

**Standardize the client on Tailwind CSS** for layout, spacing, typography, and color. Move away from ad hoc `<style>` blocks and one-off rules toward **shared utility patterns** and a **small, intentional global layer** (design tokens, resets, and cases Tailwind does not cover well).

**Default:** preserve the **existing look and feel** where it is already good; **fix** places that are inconsistent, duplicated, or hard to maintain (magic numbers, slightly different grays, competing flex hacks).

## Motivation

- **Consistency:** The UI grew faster than a single system; the same “kind” of surface can be styled three different ways.
- **Velocity:** A Tailwind-first baseline makes new components faster and code review easier (“use the same `gap` / `text-muted` story as X”).
- **Maintenance:** Scattered one-off CSS increases the cost of theme tweaks, dark-mode work, and accessibility passes.

## Goals

1. **Tailwind as default** — New and refactored components prefer Tailwind utility classes; `@apply` or small component layers only when it improves clarity.
2. **Prune ad hoc CSS** — Reduce or **eliminate** one-off `<style>` / module CSS in favor of Tailwind, **except** where a **global stylesheet** (or a tightly scoped file) is clearly warranted: resets, `font-face`, print, focus-ring policy, third-party widget overrides, or a few high-leverage **design tokens** that cannot be expressed cleanly as utilities.
3. **One coherent visual system** — Align spacing, type scale, border radii, and neutrals. Replace “random” grays and sizes with the **same** scale across chat, wiki, hub, and inbox.
4. **Increase reuse** — Extract repeated patterns into:
   - shared Tailwind class clusters (Svelte `class` composition or tiny presentational subcomponents);
   - shared layout primitives (lists, cards, form rows) where the same structure appears in multiple places.
5. **Validate thoroughly** — **Automated tests** (existing Vitest / component tests) plus a **human pass** (primary flows, responsive widths, key modals). Add or extend tests when refactor touches behavior (focus traps, a11y labels, layout regressions that can be asserted).

## Non-goals (for this OPP)

- **Redesign** the product or ship a new “brand” — unless a small change falls out naturally from consolidation (e.g., one border radius instead of four).
- **Replace** Tailwind with another CSS system.
- **Rewrite** all Svelte at once — prefer **incremental** merges on the branch, slice by feature area, with CI green on each step.

## Workflow

1. **Branch** — e.g. `refactor/tailwind-global` (name is team preference; keep it obvious in PR titles).
2. **Inventory (optional but useful)** — List major `.svelte` files with large `<style>` blocks; note global entry CSS (e.g. app shell imports).
3. **Slicing** — Order by user-visible surface (e.g. chat → sidebar → wiki → hub) or by “most duplicated pain.”
4. **Each slice:** move styles → Tailwind; delete dead rules; add/adjust tests; **screenshot or manual checklist** for that slice.
5. **Before merge to main:** `npm run lint` and full test pass per [AGENTS.md](../../AGENTS.md); resolve visual regressions.

## Success criteria

- [ ] Conventions are documented in a **short** note (where to put global CSS vs Tailwind; when to add a subcomponent).
- [ ] **Net reduction** in bespoke CSS (lines and file count), with a **small, justified** global stylesheet.
- [ ] **No major visual regressions** in core flows; known intentional tweaks listed in the PR.
- [ ] **Tests** cover touched behavior; CI stays green.

## Related

- [AGENTS.md](../../AGENTS.md) — Svelte 5, lint/test expectations.
- [archived OPP-007](archive/OPP-007-native-mac-app.md) — Native shell; refactors should remain OK in Tauri webview.
- Svelte 5 + styling skills under `.cursor` / Svelte MCP for component-level best practices when implementing.
