# BUG-005: Client UI styling — idiomatic Tailwind, less bespoke CSS, more reuse

## Summary

The Svelte client uses **Tailwind CSS v4** (via `@tailwindcss/vite` and `@import "tailwindcss"` in `src/client/style.css`), but styling is **not idiomatic**: most surfaces combine **large scoped `<style>` blocks**, **global CSS variables**, and **ad hoc utility classes**. The same layout and chrome patterns are reimplemented across components instead of flowing from **shared tokens, components, and class recipes**. This bug tracks converging on a **consistent, maintainable** styling approach without mandating a single big-bang rewrite.

## Symptoms

- **Mixed patterns:** Components alternate between Tailwind utilities (`flex`, `gap-*`, `min-h-0`), arbitrary values (`bg-[var(--bg)]`), and **component-scoped rules** for things that could be **design tokens** or **reusable primitives** (buttons, panels, list rows, headers).
- **Heavy global CSS:** `style.css` defines extensive `:root` variables and base rules (reasonable for theming), but **overlap** with per-component rules increases the surface area when changing look-and-feel.
- **Low reuse:** Repeated flex/column/scroll **layouts**, **pane chrome**, and **spacing** appear as copy-pasted class strings or duplicated selectors rather than **small shared Svelte components** or **Tailwind `@apply` / component classes** in one place.
- **Conditional styling friction:** Where classes are built or toggled in **`<script>`**, string concatenation and one-off helpers add **custom JS** with no project-standard use of **`tailwind-merge`** / **`tailwind-variants`** (or equivalent), so merges and variants are easy to get wrong or verbose.

## Root causes (current understanding)

1. **Incremental growth:** Features landed quickly with whatever worked (scoped CSS + a few utilities), before a **layered** convention (tokens → primitives → screens) was established.
2. **Tailwind as optional garnish:** Utilities are used for layout in places, but **theme and components** are not fully expressed through **Tailwind v4 theme extension** (`@theme`, shared CSS first) so tokens stay partly in raw CSS and partly in class strings.
3. **Missing shared UI layer:** Few **leaf components** encapsulate repeated structure (e.g. “scrollable column with header”), so every screen reinvents similar markup and styles.

## Goal

- **Idiomatic Tailwind:** Express **spacing, typography, radii, and colors** through **Tailwind theme / CSS variables wired into `@theme`**, so utilities read naturally (`bg-background`, `text-muted`, etc.) instead of long `var(--…)` chains in every template—where it improves clarity without fighting the stack.
- **Less bespoke CSS:** Shrink **per-component** `<style>` blocks by **moving repeated rules up** (theme, shared component CSS, or `@apply` in a **small** number of curated component classes—not a giant `@apply` soup).
- **More reuse:** Extract **repeated layouts and controls** into **shared Svelte components** (and/or shared class helpers) so fixes propagate in one place.
- **Safer class composition:** Adopt **`tailwind-merge`** (and optionally **`tailwind-variants`**) for dynamic `class` strings in TS/Svelte, with a **single** `cn()` (or similarly named) helper used consistently.

## Non-goals

- **No requirement** to delete all scoped CSS (some things—complex selectors, third-party overrides—stay in CSS).
- **No big-bang** rewrite: migrate **high-churn** or **duplicated** areas first; new work should follow the **target conventions** from the start.

## Fix direction (incremental)

| Area | Direction |
| ---- | --------- |
| Tokens | Map existing `:root` / dark-mode variables into **Tailwind theme** (v4 `@theme` + CSS variables) so utilities and components share one source of truth. |
| Primitives | Introduce or extend **small shared components** (e.g. panel shell, icon button, list row) used by chat, wiki, inbox, onboarding. |
| Utilities | Prefer **utilities + theme tokens** for layout and color; reserve scoped CSS for **exceptions** (scrollbars, deep overrides, animations). |
| Composition | Add **`tailwind-merge`** + a **`cn()`** helper; use **`tailwind-variants`** where variant APIs reduce branching in script. |
| Hygiene | When touching a file for other reasons, **nudge** it toward the conventions above; optional lint rule or grep in CI for discouraged patterns only if the team wants enforcement. |

## Verification

- **Visual:** No regressions in primary flows (chat, wiki, inbox, onboarding) on **light and dark** system themes.
- **Build:** `npm run build` / client bundle unchanged or smaller; no new duplicate CSS explosions from mis-merged classes.
- **Tests:** Existing Vitest coverage unchanged; add tests only if new **pure TS** helpers (`cn`, variant maps) warrant them.

## Related

- `src/client/style.css` — global import of Tailwind + tokens + base styles
- `vite.config.ts` — `@tailwindcss/vite` plugin
- [ARCHITECTURE.md](../ARCHITECTURE.md) — if extended later with a short “client styling” subsection
