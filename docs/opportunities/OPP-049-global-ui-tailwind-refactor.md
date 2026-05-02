# OPP-049: Global UI refactor — Tailwind-first stylesheet

**Status:** **Completed (main merge).** The strangler `tw-components/` tree is promoted to the sole [`src/client/components/`](../../src/client/components/); imports use `@components/…`. Further work (tokens, `@theme`, pruning remaining scoped CSS) continues as normal product hygiene—see [tailwind-migration](../architecture/tailwind-migration.md).

**Previous:** Proposed (long-running epic).

**Execution model:** Treat as a **dedicated branch** effort; use a **large, capable model** for breadth across the Svelte client (many files, style archaeology). **No rush**—optimize for **consistency and test coverage** over a single big bang.

**Supersedes:** [BUG-005](../bugs/archive/BUG-005-tailwind-css-consolidation.md) (archived)—this opportunity is the **superset** tracking the same problem space (idiomatic Tailwind, reuse, responsive consolidation, `tailwind-merge`/variants). Work is intentionally **not** scoped as a separate active bug.

## Summary

**Standardize the client on Tailwind CSS** for layout, spacing, typography, and color. Move away from ad hoc `<style>` blocks and one-off rules toward **shared utility patterns** and a **small, intentional global layer** (design tokens, resets, and cases Tailwind does not cover well).

The Svelte client already uses **Tailwind CSS v4** (via `@tailwindcss/vite` and `@import "tailwindcss"` in `src/client/style.css`), but styling is **not idiomatic**: many surfaces combine **large scoped `<style>` blocks**, **global CSS variables**, and **ad hoc utility classes**. Layout and chrome patterns are reimplemented instead of flowing from **shared tokens, components, and class recipes**.

**Default:** preserve the **existing look and feel** where it is already good; **fix** places that are inconsistent, duplicated, or hard to maintain (magic numbers, slightly different grays, competing flex hacks).

## Motivation

- **Consistency:** The UI grew faster than a single system; the same “kind” of surface can be styled three different ways.
- **Velocity:** A Tailwind-first baseline makes new components faster and code review easier (“use the same `gap` / `text-muted` story as X”).
- **Maintenance:** Scattered one-off CSS increases the cost of theme tweaks, dark-mode work, and accessibility passes.
- **Responsive sprawl:** Many files repeat `**@media (max-width: 768px)`** / `**(min-width: 768px)**` in scoped CSS instead of **Tailwind’s `md` / `max-md` (and friends)** and a **single** breakpoint story. That duplicates magic numbers, drifts from `**WORKSPACE_DESKTOP_SPLIT_MIN_PX`**, and underuses **container queries** where panes (not the viewport) set the real width.

### Symptoms (detail)

- **Mixed patterns:** Components alternate between Tailwind utilities (`flex`, `gap-*`, `min-h-0`), arbitrary values (`bg-[var(--bg)]`), and **component-scoped rules** for things that could be **design tokens** or **reusable primitives** (buttons, panels, list rows, headers).
- **Heavy global CSS:** `style.css` defines extensive `:root` variables and base rules (reasonable for theming), but **overlap** with per-component rules increases the surface area when changing look-and-feel.
- **Low reuse:** Repeated flex/column/scroll **layouts**, **pane chrome**, and **spacing** appear as copy-pasted class strings or duplicated selectors rather than **small shared Svelte components** or **Tailwind `@apply` / component classes** in one place.
- **Brittle responsive breakpoints:** Many components repeat `**768px`** media in scoped `<style>` instead of **Tailwind responsive variants** (`md:`, `max-md:`) aligned with a **single** breakpoint definition.
- **Conditional styling friction:** Where classes are built or toggled in `**<script>`**, string concatenation and one-off helpers add **custom JS** with no project-standard use of `**tailwind-merge`** / `**tailwind-variants**` (or equivalent), so merges and variants are easy to get wrong or verbose.
- **Svelte `:global` at composition boundaries (code smell):** Scoped `<style>` only attaches to elements **declared in that file**. Content passed via **snippets / slots** (e.g. modal footer actions rendered by a parent) lives under another component’s scope, so the shell cannot style those nodes with plain class selectors—it needs `**:global(...)`** (or duplicate rules) for basics like primary vs secondary buttons and hover. That is **fragile** (easy to miss a pseudo-class and get bad contrast, as with a blanket `button:hover`), **non-obvious** to readers, and **opaque** in review. A Tailwind-first approach should prefer **utilities and variants on the real element** or **small shared button/dialog primitives** so styling is colocated with markup instead of cross-scope selector games.

### Root causes (current understanding)

1. **Incremental growth:** Features landed quickly with whatever worked (scoped CSS + a few utilities), before a **layered** convention (tokens → primitives → screens) was established.
2. **Tailwind as optional garnish:** Utilities are used for layout in places, but **theme and components** are not fully expressed through **Tailwind v4 theme extension** (`@theme`, shared CSS first) so tokens stay partly in raw CSS and partly in class strings.
3. **Missing shared UI layer:** Few **leaf components** encapsulate repeated structure (e.g. “scrollable column with header”), so every screen reinvents similar markup and styles.
4. **Responsive as raw CSS:** Mobile vs desktop adjustments were added as **per-file media queries** before a convention for **mobile-first utilities**, `**max-*` variants**, or **container queries** for pane-local width; that predates treating Tailwind’s `**md`** (768px) as the **named** breakpoint everywhere.

## Goals

1. **Tailwind as default** — New and refactored components prefer Tailwind utility classes; `@apply` or small component layers only when it improves clarity.
2. **Prune ad hoc CSS** — Reduce or **eliminate** one-off `<style>` / module CSS in favor of Tailwind, **except** where a **global stylesheet** (or a tightly scoped file) is clearly warranted: resets, `font-face`, print, focus-ring policy, third-party widget overrides, or a few high-leverage **design tokens** that cannot be expressed cleanly as utilities.
3. **One coherent visual system** — Align spacing, type scale, border radii, and neutrals. Replace “random” grays and sizes with the **same** scale across chat, wiki, hub, and inbox.
4. **Increase reuse** — Extract repeated patterns into:
  - shared Tailwind class clusters (Svelte `class` composition or tiny presentational subcomponents);
  - shared layout primitives (lists, cards, form rows) where the same structure appears in multiple places.
5. **Validate thoroughly** — **Automated tests** (existing Vitest / component tests) plus a **human pass** (primary flows, responsive widths, key modals). Add or extend tests when refactor touches behavior (focus traps, a11y labels, layout regressions that can be asserted).
6. **Responsive & breakpoints** — Prefer **utilities** (`md:`, `max-md:`) over hand-rolled **768px** blocks; document **mobile-first vs max-** policy per shell area; use **container queries** where layout depends on **column / pane width**. Centralize global `**:root`** breakpoint-driven tokens in `**style.css**`; align **JS** (`matchMedia`, `WORKSPACE_DESKTOP_SPLIT_MIN_PX`) with the **same** named breakpoint.
7. **Idiomatic theme** — Express **spacing, typography, radii, and colors** through **Tailwind theme / CSS variables wired into `@theme`**, so utilities read naturally (`bg-surface`, `text-muted`, etc.) instead of long `var(--…)` chains in every template where it improves clarity.
8. **Safer composition** — Adopt `**tailwind-merge`** (and optionally `**tailwind-variants**`) for dynamic `class` strings in TS/Svelte, with a **single** `cn()` (or similarly named) helper used consistently.

## Non-goals (for this OPP)

- **Redesign** the product or ship a new “brand” — unless a small change falls out naturally from consolidation (e.g., one border radius instead of four).
- **Replace** Tailwind with another CSS system.
- **Rewrite** all Svelte at once — prefer **incremental** merges on the branch, slice by feature area, with CI green on each step (**no mandatory big-bang**; prioritize high-churn or duplicated surfaces first).
- **Not required** to delete every scoped `<style>` block—complex selectors, third-party overrides, and exceptions stay in CSS where appropriate.

## Workflow

1. **Branch** — e.g. `refactor/tailwind-global` (name is team preference; keep it obvious in PR titles).
2. **Inventory (optional but useful)** — List major `.svelte` files with large `<style>` blocks; note global entry CSS (e.g. app shell imports).
3. **Slicing** — Order by user-visible surface (e.g. chat → sidebar → wiki → hub) or by “most duplicated pain.” Include **responsive** in each slice: replace raw **768px** media in that area with **Tailwind variants** or justified **container** rules.
4. **Each slice:** move styles → Tailwind; delete dead rules; add/adjust tests; **screenshot or manual checklist** for that slice (**narrow viewport + narrow desktop pane** where relevant).
5. **Before merge to main:** `npm run lint` and full test pass per [AGENTS.md](../../AGENTS.md); resolve visual regressions.

### Fix direction (incremental)


| Area        | Direction                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens      | Map existing `:root` / dark-mode variables into **Tailwind theme** (v4 `@theme` + CSS variables) so utilities and components share one source of truth.                                                                                |
| Primitives  | Introduce or extend **small shared components** (e.g. panel shell, icon button, list row, **dialog actions**) used by chat, wiki, inbox, onboarding—so parents aren’t forced into `**:global`** overrides to restyle snippet children. |
| Utilities   | Prefer **utilities + theme tokens** for layout and color; reserve scoped CSS for **exceptions** (scrollbars, deep overrides, animations).                                                                                              |
| Responsive  | Replace duplicate **768px** media blocks with `**md:` / `max-md:`** (or container queries) per area; global `**:root**` tweaks at breakpoints stay in `**style.css**` where they already live.                                         |
| Composition | Add `**tailwind-merge**` + a `**cn()**` helper; use `**tailwind-variants**` where variant APIs reduce branching in script.                                                                                                             |
| Hygiene     | When touching a file for other reasons, **nudge** it toward these conventions; optional lint rule or grep in CI for discouraged patterns only if the team wants enforcement.                                                           |


New work should follow target conventions **from the start**, even before the branch lands everything.

## Success criteria

- Conventions are documented in a **short** note (where to put global CSS vs Tailwind; when to add a subcomponent; **responsive**: `md` / `max-md` / containers vs raw `@media`).
- **Net reduction** in bespoke CSS (lines and file count), with a **small, justified** global stylesheet and **far fewer** duplicate **768px** blocks.
- **No major visual regressions** in core flows; known intentional tweaks listed in the PR (including **phone-width** and **desktop narrow-pane** checks).
- **Tests** cover touched behavior; CI stays green.

## Verification

- **Visual:** No regressions in primary flows (chat, wiki, inbox, onboarding) on **light and dark** system themes.
- **Build:** `npm run build` / client bundle unchanged or smaller; no new duplicate CSS explosions from mis-merged classes.
- **Tests:** Existing Vitest coverage maintained; add tests only if new **pure TS** helpers (`cn`, variant maps) warrant them.

## Related

- `src/client/style.css` — global import of Tailwind + tokens + base styles (including `:root` breakpoint overrides)
- `src/client/lib/app/workspaceLayout.ts` — `WORKSPACE_DESKTOP_SPLIT_MIN_PX` (same breakpoint family as Tailwind `md`)
- `vite.config.ts` — `@tailwindcss/vite` plugin
- [Archived BUG-005](../bugs/archive/BUG-005-tailwind-css-consolidation.md) — consolidated into this epic
- [AGENTS.md](../../AGENTS.md) — Svelte 5, lint/test expectations.
- [archived OPP-007](archive/OPP-007-native-mac-app.md) — Native shell; refactors should remain OK in Tauri webview.
- [OPP-089](OPP-089-google-design-md-exploratory.md) — optional **DESIGN.md** spike (agent-facing design spec + tooling); exploratory only, **depends on** this epic’s token baseline.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — optional future “client styling” subsection.
- Svelte 5 + styling skills under `.cursor` / Svelte MCP for component-level best practices when implementing.