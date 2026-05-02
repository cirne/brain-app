# Svelte components (`src/client/components`)

Tailwind-first UI for Braintunnel. Conventions align with [OPP-049](../../docs/opportunities/OPP-049-global-ui-tailwind-refactor.md) (merged baseline) and **[`docs/architecture/tailwind-migration.md`](../../docs/architecture/tailwind-migration.md)** (cascade pitfalls, responsive policy).

## Imports

- Use the **`@components/...`** path alias for cross-component imports (mirrors `src/client/components/`).

## Styling

- Prefer **Tailwind utilities** for layout, spacing, color, typography, and responsive behavior (`md:` / `max-md:` aligned with `WORKSPACE_DESKTOP_SPLIT_MIN_PX` where JS cares).
- Use **`cn()`** from [`../lib/cn.ts`](../lib/cn.ts) for dynamic class strings (`tailwind-merge`).
- Use semantic tokens from `src/client/style.css` / `@theme` (`bg-surface`, `text-muted`, `border-border`, etc.) before long `var(--…)` chains.
- Keep **scoped `<style>`** only when needed: keyframes, scrollbar/mask pseudo-elements, deep `:global` for third-party widgets (TipTap, etc.), or rare cases where cascade debugging in DevTools **Computed** justifies it.

## Tests and hooks

- Preserve **stable class names** that tests or scripts assert (`composer-context-bar__refs`, `chat-pane`, `mobile-slide`, etc.) even when utilities own the look.
- Preserve **public props and events** unless a deliberate product change says otherwise.
- Component tests and **`test-stubs/`** live in this tree next to sources; see **[`docs/component-testing.md`](../../docs/component-testing.md)**.
