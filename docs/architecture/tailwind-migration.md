# Tailwind migration: completing the transition

**Status:** Tailwind is already in the build (`@import "tailwindcss"` in `src/client/style.css`, `@tailwindcss/vite` plugin in `vitest.config.ts`). The migration is completing the move from legacy scoped `<style>` blocks and BEM class names to utility classes across all components.

---

## Current state

As of April 2026:

- **68 of 129 Svelte components** contain inline `<style>` blocks with BEM-style class names (e.g. `hub-source-meta`, `hub-connector-title`, `agent-conversation-tool-call`).
- **8 standalone CSS files** under `src/client/styles/` (~1,585 lines total): onboarding, markdown rendering, agent streaming, wiki, search.
- **Global `src/client/style.css`**: `:root` tokens, **`@layer base` / `@layer components`** resets and semantic globals, typography — imports Tailwind first, then layered app rules.

The hybrid state means new components can use Tailwind utilities while old ones use scoped class names, but the two systems don't compose cleanly (e.g. a Tailwind `dark:` variant can't reach inside a scoped block).

---

## Why urgency matters

Every new component added in the BEM pattern increases future migration cost. At ~130 components the migration is a 1–2 week effort with careful per-screen QA. At 250+ components it becomes a multi-week project requiring a dedicated pass. The window to do it cheaply is while the component count is still low.

---

## Approach

### Shared utility conventions

- Prefer Tailwind utilities for layout, spacing, typography, color, borders, and responsive behavior.
- Use the semantic tokens exported from `src/client/style.css` / `@theme` (`bg-surface`, `bg-surface-2`, `text-foreground`, `text-muted`, `border-border`, `max-w-chat`, etc.) before reaching for raw `var(--...)` chains.
- Use `cn()` from `src/client/lib/cn.ts` for reusable or dynamic Tailwind class strings. It accepts the same object/array/string shapes as Svelte's `class` attribute and runs `tailwind-merge` so later conflicting utilities win predictably.
- Keep existing semantic/BEM class names when tests, JS hooks, or complex scoped selectors still need them; treat those names as hooks, not as the primary styling layer.

### Responsive policy

- Use Tailwind's `md:` and `max-md:` variants for the standard workspace breakpoint instead of component-scoped `@media (min-width: 768px)` / `@media (max-width: 768px)` blocks.
- Keep global breakpoint-driven CSS variables in `src/client/style.css` when they are true app-level tokens (for example touch-oriented `--tab-h` tweaks).
- Use container queries for layouts whose behavior depends on pane width rather than viewport width.
- Keep JS media queries aligned with `WORKSPACE_DESKTOP_SPLIT_MIN_PX` in `src/client/lib/app/workspaceLayout.ts`.

### CSS custom properties — keep

The `:root` token layer (`--color-bg`, `--color-text`, `--radius-md`, etc.) in `style.css` is the right abstraction. These tokens let Tailwind utilities reference design system values and support future theming. Map Tailwind's `theme.extend` to these tokens rather than replacing them.

### Scoped `<style>` blocks — migrate to utilities

For each component with a `<style>` block:
1. Convert BEM class selectors to Tailwind utility strings on the element.
2. Remove the `<style>` block.
3. For complex selectors (`:global`, pseudo-elements, generated content), keep a minimal scoped block or use `@apply` sparingly.

### Standalone CSS files — case by case

- `styles/wiki/markdownCore.css` and `wikiMarkdown.css` — keep as-is; these style agent-generated markdown output that can't carry class attributes.
- `styles/agent-conversation/streamingAgentMarkdown.css` — same rationale as above.
- `styles/onboarding/` — candidates for migration if the components that import them are being touched.

### Migration order

Prioritize by component size and touch frequency:
1. New components — always Tailwind.
2. Components undergoing feature work — migrate `<style>` as part of the PR.
3. Batch cleanup passes — one subsystem at a time (hub-connector, agent-conversation, onboarding).

---

## Pitfalls: when utilities “don’t apply” (cascade & layout)

Tailwind **is** generating the classes; if padding, margin, or font-size **look** ignored, something else is winning or the layout pattern fights the utility. Document this so we don’t confuse “Tailwind is broken” with “we need one source of truth per property.”

### 1. Inspect the winner (required habit)

In DevTools → **Computed**, click the property (e.g. `padding-left`). The **cascade** pane shows **which rule applied**. If it’s not the utility, note the file/selector and fix **that** conflict (don’t stack more utilities blindly).

### 2. CSS layers (Tailwind v4)

Tailwind utilities normally live in **`@layer utilities`**. **Unlayered** rules elsewhere in `style.css` or other global CSS can override layered utilities **without** obviously higher specificity.

**Mitigation:** Prefer keeping app-wide rules in **`@layer base`** / **`@layer components`** (or aligned with Tailwind’s layering), or ensure global rules don’t set the same properties you expect utilities to own on those nodes.

### Global CSS layering (`src/client/style.css`)

[`src/client/style.css`](../../src/client/style.css) follows this convention:

| Layer | Contents |
|-------|----------|
| **`@layer base`** | Universal reset (`*` / `::before` / `::after`), `:root` + dark `:root`, `html` / `body` / `#app`, `button`, `a`, scrollbar pseudo-elements, sync `@keyframes` / helper classes and mobile `:root` variable tweaks |
| **`@layer components`** | Semantic app classes whose properties **overlap** Tailwind spacing / width (currently **`.chat-transcript-scroll`** and its split-pane max-width rule) |

**Standalone CSS** pulled in beside Tailwind (`styles/search/*.css`, `styles/onboarding/*.css`) is imported **into a named layer**:

`@import "./styles/..." layer(base)` or `layer(components)` so those files are not **unlayered** surprises.

Utilities should express **pane gutters** (`ChatHistory` **`.ch-scroll`**, inbox **`.thread-body`**) directly on the element when possible — **scoped** rules on the same node still beat a single utility (see §3).

**Later cleanup:** Preflight already sets **`box-sizing: border-box`** on `*`. Full removal of **`margin` / `padding` zero on `*`** vs Preflight duplication is intentionally conservative until regressions have been eyeballed (onboarding, assistant transcript, inbox thread).

### 3. Svelte scoped `<style>` specificity

A scoped rule like `.ch-scroll.svelte-xxx` targets **two classes** on the element. If it sets the same property as a **single** utility (e.g. `.px-4`), the scoped rule **often wins**. Mixing “semantic class + Tailwind utilities” on the same node without checking Computed is a common footgun.

**Mitigation:** Either (a) don’t set that property in scoped CSS, (b) move spacing to utilities only, or (c) use **`@apply`** inside scoped CSS so values still come from the theme with one clear owner.

### 4. Flexbox and `margin: auto`

Example: a **column flex** child with **`align-items: stretch`** (default) and `margin-left/right: auto` may **not** center the way you expect; cross-axis stretch can interact badly with percentage widths.

**Mitigation:** `self-center`, a wrapper, or explicit width + margin recipe—see **`AgentChat` composer column** (split + `composer-stack`). Verify in Computed after changes.

### 5. Temporary parity: legacy-shaped scoped CSS

When matching **legacy `components/`** behavior quickly (e.g. **chat history rail**), a **scoped block that mirrors legacy** can be legitimate **short-term parity**, not an admission that Tailwind can’t own spacing forever.

**Follow-up:** Re-express layout with utilities (or **`@apply`**) **incrementally**, confirming each step in Computed — see [tw-components README](../../src/client/tw-components/README.md).

### OPPORTUNITIES vs architecture

- **`docs/opportunities/`** — track **work items** (e.g. [OPP-049](../opportunities/OPP-049-global-ui-tailwind-refactor.md)), not cascade debugging recipes.
- **`docs/architecture/tailwind-migration.md`** (this file) — **how we migrate** and **how we debug** when styling surprises us.

---

## What not to do

- Don't use `@apply` to recreate BEM class names in Tailwind. That defeats the point.
- Don't introduce a CSS-in-JS or CSS modules layer. Tailwind utilities + Svelte scoped blocks for edge cases is the entire story.
- Don't migrate the markdown output CSS files — content rendered from markdown needs class-based targeting.

---

*Back: [README.md](./README.md)*
