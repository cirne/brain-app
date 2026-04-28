# BUG-005: Client UI styling — idiomatic Tailwind, less bespoke CSS, more reuse

**Status:** Archived — **superseded by [OPP-049](../../opportunities/OPP-049-global-ui-tailwind-refactor.md).**

**Tags:** `client`, `tailwind`, `css`, `responsive`

## Summary

This bug tracked **non-idiomatic Tailwind usage** on the Svelte client: heavy scoped CSS mixed with globals, duplicated layouts, scattered **`768px`** media queries, and ad hoc `class` composition without **`tailwind-merge`** / **`tailwind-variants`**.

**Resolution:** The scope is **rolled into OPP-049** (global Tailwind-first UI refactor). That opportunity is the **superset** work item: same symptoms, root causes, incremental fix table, and verification—plus workflow, success criteria, and execution model. **Do not** revive this bug as an active duplicate; track progress on **OPP-049** only.

**Original file path:** `docs/bugs/BUG-005-tailwind-css-consolidation.md` (removed when consolidated into OPP-049, 2026-04-28).
