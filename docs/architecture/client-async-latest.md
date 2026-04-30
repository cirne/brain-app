# Client UI: overlapping async (“latest wins”) fetches

When the user or the **agent** navigates quickly (open email, wiki path, file, chat session, search query, calendar week), the UI can start a second `fetch` before the first completes. If the slower response commits to `$state` last, the panel shows the **wrong** content or a spurious error until a manual refresh.

## Standard pattern

Use [`createAsyncLatest`](../../src/client/lib/asyncLatest.ts) from the client lib:

1. One gate per logical surface (e.g. inbox thread load, wiki page load).
2. Call `const { token, signal } = latest.begin()` when starting a new keyed request.
3. Pass `signal` into `fetch` when `abortPrevious: true` (default for navigation-bound loads).
4. After **every** `await`, skip UI updates if `latest.isStale(token)`.
5. In `catch`, ignore `isAbortError` and stale tokens so aborted requests do not surface as errors.
6. Clear `loading` in `finally` only when `!latest.isStale(token)`.

Hand-rolled `cancelled` flags in `$effect` cleanups are equivalent; the shared helper keeps behavior consistent and documents intent.

## Where this is applied

| Area | Module |
|------|--------|
| Inbox thread body | [`src/client/lib/Inbox.svelte`](../../src/client/lib/Inbox.svelte) |
| Raw file preview | [`src/client/lib/FileViewer.svelte`](../../src/client/lib/FileViewer.svelte) |
| Wiki page GET + server refresh | [`src/client/lib/Wiki.svelte`](../../src/client/lib/Wiki.svelte) |
| Chat session hydrate | [`src/client/lib/AgentChat.svelte`](../../src/client/lib/AgentChat.svelte) |
| Unified search overlay | [`src/client/lib/Search.svelte`](../../src/client/lib/Search.svelte) |
| Calendar week grid | [`src/client/lib/Calendar.svelte`](../../src/client/lib/Calendar.svelte) |
| Single-day calendar fetch | [`src/client/lib/DayEvents.svelte`](../../src/client/lib/DayEvents.svelte) |
| Hub connector source panel | [`src/client/components/hub-connector/HubConnectorSourcePanel.svelte`](../../src/client/components/hub-connector/HubConnectorSourcePanel.svelte) |
| iMessage thread | [`src/client/lib/MessageThread.svelte`](../../src/client/lib/MessageThread.svelte) |
| Calendar related context | [`src/client/lib/CalendarEventDetail.svelte`](../../src/client/lib/CalendarEventDetail.svelte) |

## When not to use

- Fire-and-forget telemetry or background work that should finish even after navigation.
- Mutations where you intentionally want the response to apply regardless (rare in overlay UI).

## Related docs

- [runtime-and-routes.md](./runtime-and-routes.md) — SPA routes: **`/c` / `/c/:sessionId`** (chat), **`/hub`**, overlays via **`?panel=`** + payload keys ([OPP-058](../opportunities/OPP-058-spa-url-main-pane-vs-overlay-query.md)).
- [agent-chat.md](./agent-chat.md) — tools that drive shell navigation.
