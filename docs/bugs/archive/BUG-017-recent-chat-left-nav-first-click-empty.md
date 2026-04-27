# BUG-017: Recent chat in left nav sometimes opens empty new chat on first click

**Status:** Fixed (2026-04-24)  
**Source:** Local feedback issue `#1` (`2026-04-24T15:22:36.742Z-issue-1.md` under `$BRAIN_HOME/issues`).

## Resolution

`selectChatSession` could run with **`AgentChat` unmounted** while the app was still on a **Brain Hub** URL (`/hub` or `/hub/…`). In that case `closeOverlayImmediate()` did not return to the main chat shell, so `agentChat?.loadSession` was a no-op. The fix exits Hub with `navigate({ hubActive: false })` (same as **New chat**) and `await tick()` before `loadSession` — `Assistant.svelte`.

## Symptom

When the user selects a **recent chat** from the **left navigation**, the app **sometimes** opens an **empty new chat** view instead of the conversation they chose. Clicking the **same** recent item **again** then opens the **correct** chat. Behavior feels **intermittent**, possibly a **race** between navigation and chat load.

## Expected behavior

One click on a recent chat in the left nav should always show that session’s messages (or a clear loading state that resolves to that chat), not a blank new chat.

## Repro (from user report)

1. Open Brain with multiple chats / recents available.
2. In the **left nav**, click a **recent** chat.
3. **Sometimes** observe an **empty new chat** instead of the selected thread.
4. Click the **same** recent item again.
5. The **correct** chat appears on the second click.

## Notes

- No PII in the original feedback; treat as a **UI / routing / session selection** issue.
- Consider timing: first navigation vs. session id resolution, Svelte reactivity, or duplicate “new chat” route firing.

## Likely areas to inspect

- Client components that map **recents** → **active session** (e.g. nav / sidebar, chat list, router).
- Any **debounce** or **async** order where “new chat” runs before `sessionId` is applied.

## Related

- OPP-048 on-disk issue `issueId: 1` for the raw capture.
