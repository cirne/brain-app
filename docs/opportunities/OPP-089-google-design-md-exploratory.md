# OPP-089: DESIGN.md — exploratory design-system spec for agents (Google `design.md`)

**Status:** Proposed — **exploration / spike**. Decide after a time-boxed trial whether to adopt, park, or archive.

**Depends on:** [OPP-049](OPP-049-global-ui-tailwind-refactor.md) — wait until Tailwind-first **tokens / `@theme`** are far enough along that a written spec stays aligned with the real stylesheet; DESIGN.md does not substitute for consolidating tokens in code.

## Summary

Evaluate **[google-labs-code/design.md](https://github.com/google-labs-code/design.md)** (format: YAML design tokens + markdown rationale; **`@google/design.md`** CLI **`lint`** / **`diff`** / **`export`** including **`export --format tailwind`**). Goal: see whether a repo-level **`DESIGN.md`** improves **coding-agent consistency** and **documentation of visual intent** without forcing a rewrite of components.

This is **not** a Tailwind replacement; it complements a Tailwind-first client by optionally **documenting tokens** or **exporting theme-shaped JSON**.

## Motivation

- Agents and humans lack a single, **lintable** “here is our palette/type/spacing/components story” artifact today; tokens live partly in **`src/client/style.css`** and partly in scattered utilities.
- The upstream tool’s **Tailwind export** path fits post–OPP-049 theme work—but the format is **alpha**, so committing early without a spike risks churn.

## Exploration scope (non-binding)

Time-box **~0.5–2 dev days**:

1. Add a scratch **`DESIGN.md`** loosely matching current Braintunnel tokens after OPP-049 progress (or a thin slice aligned with **`style.css`**).
2. Run **`npx @google/design.md lint DESIGN.md`** and **`export --format tailwind`**; note gaps vs Tailwind v4 **`@theme`** in this repo.
3. Decide whether any of these are worth continuing:
   - keep **`DESIGN.md`** as agent-facing prose + tokens (**lint in CI optional**),
   - treat **`DESIGN.md` → export** as a **generator input** alongside or instead of manually duplicating tokens,
   - or drop with notes (park until upstream stabilizes).

## Non-goals (for this OPP unless exploration upgrades it)

- **Mandatory** redesign of every component’s CSS.
- **Blocking** [OPP-049](OPP-049-global-ui-tailwind-refactor.md) — sibling effort; **defer** DESIGN.md substantive work behind token consolidation.
- Replacing **`style.css`** or Tailwind outright.

## Risks / notes

- **Alpha spec/tooling:** format and **`@google/design.md`** may change; budget for delete/replace of the exploratory file if we abandon.

## Related

- [OPP-049 — Global UI refactor (Tailwind-first)](OPP-049-global-ui-tailwind-refactor.md)
- [architecture/tailwind-migration.md](../architecture/tailwind-migration.md)
- Upstream README / spec: [github.com/google-labs-code/design.md](https://github.com/google-labs-code/design.md)
