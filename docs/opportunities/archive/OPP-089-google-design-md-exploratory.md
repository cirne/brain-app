# Archived: OPP-089 — DESIGN.md exploratory (Google `design.md`)

**Status: Archived — spike complete (2026-05-11).** The repo ships an agent-facing **`DESIGN.md`** (palette, type, spacing, visual intent) kept in sync with **`src/client/style.css`**; **`npm run design:lint`** validates the DESIGN.md schema. Optional follow-ons later: CI gate, **`@google/design.md`** export tooling, richer component catalog.

---

# OPP-089: DESIGN.md — exploratory design-system spec for agents (Google `design.md`)

**Status:** Complete for this backlog scope; see archive banner above. Reopen only for optional CI, export tooling, or broader catalog work.

**Depends on:** [OPP-049](./OPP-049-global-ui-tailwind-refactor.md) — **shipped (2026-05-02)** for component-tree consolidation; substantive DESIGN.md work should still wait until **tokens / `@theme`** in `style.css` are stable enough that a written spec matches the real stylesheet.

## Summary

Evaluate **[google-labs-code/design.md](https://github.com/google-labs-code/design.md)** (format: YAML design tokens + markdown rationale; **`@google/design.md`** CLI **`lint`** / **`diff`** / **`export`** including **`export --format tailwind`**). Goal: see whether a repo-level **`DESIGN.md`** improves **coding-agent consistency** and **documentation of visual intent** without forcing a rewrite of components.

This is **not** a Tailwind replacement; it complements a Tailwind-first client by optionally **documenting tokens** or **exporting theme-shaped JSON**.

## Motivation

- Agents and humans lack a single, **lintable** “here is our palette/type/spacing/components story” artifact today; tokens live partly in **`src/client/style.css`** and partly in scattered utilities.
- The upstream tool’s **Tailwind export** path fits post–tailwind-migration theme work—but the format is **alpha**, so committing early without a spike risks churn.

## Exploration scope (non-binding)

Time-box **~0.5–2 dev days**:

1. Add a scratch **`DESIGN.md`** loosely matching current Braintunnel tokens once token work has settled (or a thin slice aligned with **`style.css`**).
2. Run **`npx @google/design.md lint DESIGN.md`** and **`export --format tailwind`**; note gaps vs Tailwind v4 **`@theme`** in this repo.
3. Decide whether any of these are worth continuing:
   - keep **`DESIGN.md`** as agent-facing prose + tokens (**lint in CI optional**),
   - treat **`DESIGN.md` → export** as a **generator input** alongside or instead of manually duplicating tokens,
   - or drop with notes (park until upstream stabilizes).

## Non-goals (for this OPP unless exploration upgrades it)

- **Mandatory** redesign of every component’s CSS.
- Replacing **`style.css`** or Tailwind outright.

## Risks / notes

- **Alpha spec/tooling:** format and **`@google/design.md`** may change; budget for delete/replace of the exploratory file if we abandon.

## Related

- [OPP-049 — Global UI refactor (Tailwind-first)](./OPP-049-global-ui-tailwind-refactor.md)
- [architecture/tailwind-migration.md](../../architecture/tailwind-migration.md)
- Upstream README / spec: [github.com/google-labs-code/design.md](https://github.com/google-labs-code/design.md)
