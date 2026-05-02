# tw-components — Tailwind-first migration target

Strangler-fig destination for the Tailwind-first refactor tracked in
[OPP-049](../../../docs/opportunities/OPP-049-global-ui-tailwind-refactor.md).

## Conventions

- One Tailwind-first replacement per legacy `src/client/components/...` file.
- Path alias: `@tw-components/...` (mirrors `@components/...`).
- **End state:** internal imports between migrated components use `@tw-components/...`.
- **During migration:** a `@tw-components` file may temporarily import a not-yet-migrated
  child from `@components/...`. Mark these with `// TODO(tw): switch to @tw-components when migrated`.
  We will sweep these once the migration is complete.
- Test files stay alongside the **legacy** `@components/...` source until the final flip.
  The legacy tree is untouched, so existing tests keep passing throughout the migration.
- Prefer Tailwind utilities for layout, spacing, color, typography, and
  responsive behavior. Use `cn()` from `@client/lib/cn.js` for dynamic
  class strings.
- Keep scoped `<style>` blocks only for:
  - keyframes / `prefers-reduced-motion` exceptions
  - masks, scrollbar pseudo-elements, deep `:global` selectors
  - third-party widget overrides (TipTap, lucide internals, etc.)
- Preserve the legacy class names that tests assert (`composer-context-bar__refs`,
  `chat-pane`, `mobile-slide`, etc.) as hooks, even when they no longer carry style.
- Preserve public props/events. Migration changes styling, not contracts.
- Replace component-scoped `@media (max-width: 768px)` and `(min-width: 768px)`
  with Tailwind's `max-md:` / `md:` variants (the workspace breakpoint family
  documented in `docs/architecture/tailwind-migration.md`).

## Migration order

Working from leaves up:

1. `cards/` (small preview cards)
2. `agent-conversation/` (already partly Tailwind-first)
3. `onboarding/` leaves
4. `hub-connector/` + `statusBar/`
5. `calendar/` leaves + `Calendar*`, `DayEvents`
6. `Wiki*`, `YourWikiDetail`, `WikiShareDialog`
7. `Inbox`, `MailSearchResultsPanel`, `MessageThread`, `EmailDraftEditor`
8. `Search`, `FileViewer`, `CsvSpreadsheet*`, `IndexedFileViewer`
9. `shell/SlideOver`, `AssistantSlideOver`, `WorkspaceSplit`
10. `AppTopNav`, `AgentChat`, `Assistant`, `ChatHistory*`, `AgentInput`
11. `BrainHubPage`, `BrainSettingsPage`, hub panels
12. Remaining (`ConfirmDialog`, voice components, `Home`, etc.)
13. `App.svelte` import sweep, then promote `tw-components/` to `components/`.

The legacy `components/` tree stays in place for reference until user testing
signs off, at which point we delete it and rename `tw-components/` →
`components/` (single sweeping commit).
