# BUG-054: Client naming hygiene — misnamed components/modules (left rail, search, agent surface)

**Status:** Open  
**Tags:** `client` · `svelte` · `refactor` · `dx` · `naming`  

**Impact:** **Developer confusion** and slower onboarding, not an end-user-visible defect. Renames will touch **many files** (imports, tests, stubs, e2e, CSS hooks, i18n keys, docs). Prefer **mechanical renames in one or a few focused PRs** with `git grep` checklists rather than incremental drift.

**Origin:** Source review (2026-05) of `src/client/components` and adjacent modules — filenames and props often describe an older, narrower responsibility than the code now implements.

---

## Summary

Several high-traffic components and helpers are named for **chat history** or other **over-generic** terms while they orchestrate **assistant shell layout**, **multi-surface navigation**, or **combined wiki+mail search**. New readers follow the wrong mental model and duplicate logic because names do not match behavior.

This bug tracks **recommended rename targets** and **scope notes**. It is **not** a mandate to rename everything at once; pick clusters (e.g. left rail first) when the team has bandwidth.

---

## Recommended rename clusters (priority order)

### 1. Left assistant rail (“chat history” is the wrong noun)

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `ChatHistory.svelte` | Full **left rail**: recent chats, wiki quick links / **nav history**, tunnels, review entry, streaming indicators, etc. | e.g. `AssistantLeftRail.svelte`, `AssistantSidebarNav.svelte`, or `AssistantNavRail.svelte` (pick one vocabulary: **rail** vs **sidebar** and use it in `AppShell` comments too). |
| `chatHistoryRail.ts` | Shared Tailwind class strings for that rail’s chrome | Rename alongside the Svelte file (e.g. `assistantNavRail.ts`); keep **one** shared module for row/section button styles. |
| `AssistantHistoryRailHeader.svelte` | **Rail header only** (brand toggle + close) — no “history” UI | e.g. `AssistantRailHeader.svelte` / `AssistantSidebarHeader.svelte`. |
| `HistoryRailNavSection.svelte` | Titled section wrapper inside the rail | Rename to match chosen rail term, e.g. `AssistantRailNavSection.svelte`; update the docblock to drop “history” if misleading. |
| `AppTopNav.svelte` prop `showChatHistoryButton` | Toggles **left rail / sidebar** affordance, not “history” only | e.g. `showLeftRailToggle` / `showSidebarToggle`. |
| `ChatHistoryPage.svelte` | **Full-screen chat session list** with search (closer to truth than `ChatHistory.svelte`) | Optional: `ChatSessionsPage.svelte` / `AllChatsPage.svelte` for clarity vs the rail. |

**Related libs (partial renames or doc pass):**

- `chatHistorySessions.ts`, `chatHistoryGroups.ts`, `chatHistoryDelete.ts`, `chatHistoryStreamingIndicator.ts` — many exports are **chat-list specific** and can keep `chat` in the name; ensure **rail** code imports from clearly named modules vs “history” implying the whole sidebar.
- Tests: `ChatHistory.test.ts`, `ChatHistoryPage.test.ts`, stubs `ChatHistoryStub.svelte`, `defaultProps` helpers, `touchHoverPolicy.test.ts` (reads Svelte paths by string).
- i18n: keys under `chat.history.*` used in the rail may deserve **rail**-scoped keys if copy is not strictly “history.”

**Blast radius:** High — `Assistant.svelte`, `AppShell.svelte` comments, onboarding (`OnboardingWorkspace.svelte` passes `showChatHistoryButton`), e2e specs, component tests, CSS hooks (`ch-*` class prefixes — decide whether to rename for consistency).

---

### 2. Global “Search” vs wiki+mail unified search

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `Search.svelte` | **Combined vault search** over wiki paths + mail metadata, keyboard nav, open handlers | e.g. `VaultWikiMailSearch.svelte`, `AssistantUniversalSearch.svelte`, or `WikiAndMailSearchPanel.svelte`. |

**Blast radius:** Medium — every `import Search from ...`, test stubs (`SearchStub.svelte`), and `Assistant.svelte` / slide-over wiring; avoid clashing with Lucide `Search` icon imports (already aliased in some files).

---

### 3. Opaque layout jargon

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `PaneL2Header.svelte` | Generic **three-region** header (`left` / `center` / `right` snippets) | e.g. `PaneTriRegionHeader.svelte`, `ThreeColumnPaneHeader.svelte` — name the **structure**, not “L2”. |
| CSS class `pane-l2-header` | Same | Rename with component or leave alias during transition. |

**Blast radius:** Low–medium — grep for `PaneL2Header` and `pane-l2-header`.

---

### 4. Agent “chat” layering

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `AgentChat.svelte` | Large **orchestrator**: session store, SSE streaming, tool-open routing, composer, wiki/email/calendar bridges, modals | e.g. `AgentChatColumn.svelte`, `AgentSessionSurface.svelte`, or `AgenticChatHost.svelte` — signal **host** vs **view**. |
| `AgentConversation.svelte` | **Transcript + empty state** presentation (`AgentConversationViewProps`) | Keep or rename to `AgentConversationView.svelte` / `AgentTranscript.svelte` so “conversation” clearly means **message list**, not the whole column. |

**Blast radius:** Very high — central to the app; many tests mock `@components/AgentChat.svelte`; docs and archived BUG rows reference `AgentChat` by name.

---

### 5. Over-broad shell and workspace names

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `Assistant.svelte` | **Main application workspace**: routing, overlays, wiki primary shell, hub, settings, mobile slide-over, splits | e.g. `AssistantWorkspace.svelte`, `MainAssistantShell.svelte` — reserve **Assistant** for product-facing copy, not necessarily the root component filename. |
| `WorkspaceSplit.svelte` | **Chat column vs desktop detail pane** split (resize, fullscreen detail) | e.g. `ChatDetailSplit.svelte`, `AssistantChatDetailSplit.svelte`; props already use `chat` / `desktopDetail` snippets — name the component to match. |

**Blast radius:** High for `Assistant.svelte`; medium for `WorkspaceSplit` (fewer string references).

---

### 6. Wiki single-file surface

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `Wiki.svelte` | **Single wiki file** reader/editor (TipTap, streaming write/edit), not directory browser | e.g. `WikiPageEditor.svelte`, `WikiDocumentView.svelte` — disambiguate from **`WikiDirList`**, hub wiki panels, etc. |

**Blast radius:** High — pervasive import; many archived bugs cite `Wiki.svelte` by path.

---

### 7. Hub compact control

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `BrainHubWidget.svelte` | **Hub toolbar control**: page-count indicator + **Your Wiki** background phase (starting/enriching/cleaning/paused) | e.g. `HubWikiStatusControl.svelte`, `YourWikiHubButton.svelte` — drop vague **Widget** unless you standardize “widget” across the hub. |

**Blast radius:** Medium — i18n keys `hub.brainHubWidget.*` should move in lockstep or keep stable keys with a comment alias pass.

---

### 8. Thin `AssistantSlideOver` adapter

| Current | Actual responsibility | Suggested direction |
|--------|-------------------------|---------------------|
| `AssistantSlideOver.svelte` | **`SlideOver.svelte` wrapper** with `variant: 'mobile' \| 'desktop'` and forwarded props | Either **inline into `Assistant.svelte`** if the indirection buys little, or rename to **`AssistantSlideOverHost`** / document that it exists only to **pin `mobilePanel` from variant**. |

**Blast radius:** Low.

---

## Execution guidance

1. **Choose terminology once:** “rail” vs “sidebar” vs “left nav” — align `AppShell` snippet names (`sidebar`), comments, and component names.
2. **Mechanical rename first:** file move + export renames + TypeScript fixes; avoid behavior changes in the same PR.
3. **Test/stub sweep:** `vitest` mocks that import paths as strings; `test-stubs/*`; Playwright selectors tied to `data-testid` or class hooks (`ch-*`).
4. **i18n:** Prefer key moves in the same PR as UI rename when user-visible labels reference “history” incorrectly; otherwise leave keys stable and add a follow-up copy ticket.
5. **Docs:** Update `docs/architecture/` or component-testing notes only when filenames are part of the documented contract; keep diffs small.

---

## Non-goals

- Perfect naming across the entire repo in one change.
- Renaming **server** routes or **`chat:*` event** names unless a separate API hygiene effort wants them (client rename can remain internal).

---

## Success criteria

- A new contributor can open the **left column** implementation and find it under a name that reflects **navigation rail**, not only **chat history**.
- **Search** entry points are discoverable without assuming “global search” is a single-word component.
- **Agent** stack filenames distinguish **host/orchestrator** from **transcript view** without reading thousands of lines.
