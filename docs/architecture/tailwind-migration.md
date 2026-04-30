# Tailwind migration: completing the transition

**Status:** Tailwind is already in the build (`@import "tailwindcss"` in `src/client/style.css`, `@tailwindcss/vite` plugin in `vitest.config.ts`). The migration is completing the move from legacy scoped `<style>` blocks and BEM class names to utility classes across all components.

---

## Current state

As of April 2026:

- **68 of 129 Svelte components** contain inline `<style>` blocks with BEM-style class names (e.g. `hub-source-meta`, `hub-connector-title`, `agent-conversation-tool-call`).
- **8 standalone CSS files** under `src/client/styles/` (~1,585 lines total): onboarding, markdown rendering, agent streaming, wiki, search.
- **Global `src/client/style.css`** (~169 lines): CSS custom properties (`:root` tokens), resets, typography — already imports Tailwind.

The hybrid state means new components can use Tailwind utilities while old ones use scoped class names, but the two systems don't compose cleanly (e.g. a Tailwind `dark:` variant can't reach inside a scoped block).

---

## Why urgency matters

Every new component added in the BEM pattern increases future migration cost. At ~130 components the migration is a 1–2 week effort with careful per-screen QA. At 250+ components it becomes a multi-week project requiring a dedicated pass. The window to do it cheaply is while the component count is still low.

---

## Approach

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

## What not to do

- Don't use `@apply` to recreate BEM class names in Tailwind. That defeats the point.
- Don't introduce a CSS-in-JS or CSS modules layer. Tailwind utilities + Svelte scoped blocks for edge cases is the entire story.
- Don't migrate the markdown output CSS files — content rendered from markdown needs class-based targeting.

---

*Back: [README.md](./README.md)*
