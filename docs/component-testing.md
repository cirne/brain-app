# Svelte component tests (Vitest + Testing Library)

Brain-app’s **UI unit tests** live next to components as `*.test.ts` under [`src/client/components/`](../src/client/components/). They use **Vitest** with the **jsdom** environment, **@testing-library/svelte**, and **@testing-library/jest-dom** matchers.

End-to-end browser tests are **not** covered here; use something like Playwright when you need full-stack flows.

## Running tests

```sh
nvm use   # repo .nvmrc
npm test
```

Client component tests are isolated in a dedicated Vitest **project** (`client`) so they get jsdom + [`src/client/test/setup.ts`](../src/client/test/setup.ts). Server and `src/client/lib` tests stay on **Node** (`server` project). See [`vitest.config.ts`](../vitest.config.ts).

Run only component tests:

```sh
npx vitest run --project client
```

## Layout

| Path | Role |
|------|------|
| [`src/client/test/setup.ts`](../src/client/test/setup.ts) | jest-dom, `cleanup()`, hub store reset, `matchMedia`, mock/timer hygiene |
| [`src/client/test/mocks/`](../src/client/test/mocks/) | Shared `fetch` helpers, SSE fixtures, store helpers |
| [`src/client/test/fixtures/`](../src/client/test/fixtures/) | Factory functions for sessions, wiki rows, search hits |
| [`src/client/test/helpers/`](../src/client/test/helpers/) | Higher-level helpers: wiki slide `render`, wiki `fetch` matchers, AgentChat `fetch` stub, debounce timers, default props, `stubAppEventsEmit`, delete-chat `fetch` |
| [`src/client/test/render.ts`](../src/client/test/render.ts) | Re-export `@testing-library/svelte` queries + `render` |
| [`src/client/components/test-stubs/`](../src/client/components/test-stubs/) | Svelte stubs for heavy children (TipTap, AgentConversation, …) |

## Writing a new test

1. Add `MyWidget.test.ts` beside `MyWidget.svelte`.
2. Prefer **factories** in `fixtures/` over shared mutable objects.
3. Create **fresh** `fetch` mocks in `beforeEach` (`createMockFetch` + `vi.stubGlobal('fetch', …)`); call `vi.unstubAllGlobals()` is handled in setup, but per-test stubs should still be local. Prefer **`stubFetchForAgentChat`**, **`wikiListAndPageHandlers`**, and **`stubDeleteChatFetch`** from [`src/client/test/helpers/`](../src/client/test/helpers/) when they fit.
4. **`renderWithWikiSlideHeader`** + **`wikiHeaderRef.current`** for Wiki (or anything needing `WIKI_SLIDE_HEADER` context).
5. **`agentInputTestProps` / `chatHistoryTestProps`** for repeated callback defaults; **`useSearchDebounceTimers()`** at `describe` scope for Search-style debounce tests.
6. **`stubAppEventsEmit()`** when asserting `emit` calls without touching real listeners.
7. If a child is heavy (TipTap, full conversation UI), add or reuse a **stub** under `test-stubs/` and `vi.mock('./Child.svelte', () => import('./test-stubs/ChildStub.svelte'))`.
8. **`appEvents`**: `subscribe` returns an unsubscribe function; always unsubscribe in `afterEach` if the test registers a listener (global listeners leak across tests).

## Isolation (parallel-safe)

Vitest runs files in parallel. Rules:

- Do not rely on **order** of tests.
- Reset **singletons**: hub stores are cleared in `setup.ts`; unsubscribe `appEvents` when you subscribe in a test file.
- Use **`vi.useFakeTimers` only** in tests that need it, and rely on setup to restore real timers.
- Avoid **module-level** `vi.fn()` that carry state unless reset in `beforeEach`.

## Examples

- [`Search.test.ts`](../src/client/components/Search.test.ts) — `useSearchDebounceTimers`, `createMockFetch`.
- [`Wiki.test.ts`](../src/client/components/Wiki.test.ts) — `renderWithWikiSlideHeader`, `wikiListAndPageHandlers`, `stubAppEventsEmit`.
- [`AgentChat.test.ts`](../src/client/components/AgentChat.test.ts) — `stubFetchForAgentChat`, `agentChatPostHandler`, stream mock, stubs.

## Svelte client resolution

Component tests require the **browser** build of Svelte (`mount`), not the server entry. [`vitest.config.ts`](../vitest.config.ts) sets `resolve.conditions` to include `browser`. If you see `lifecycle_function_unavailable`, that resolution is wrong or a test file landed in the wrong Vitest project.
