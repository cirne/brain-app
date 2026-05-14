# BUG-007: Agent view scrolls to bottom on every stream delta while reading history

**Status: fixed (2026-04-17).** `followOutput` tracks whether to follow new tokens; stream callbacks use `scrollToBottomIfFollowing()`; load / stream end still call unconditional `scrollToBottom()`. **Jump to latest:** when scrolled up (`!followOutput`), a floating pill (“Latest” + chevron; live pulse while `streaming`) appears above the input column; same max-width centering as the transcript on desktop.

## Symptom

In the **agent chat** view, if you **scroll up** to read earlier messages while the assistant is still streaming (or tool activity is updating the transcript), **each append to the bottom pulls the viewport back down**. You cannot stay scrolled up to read prior context until the run finishes.

## Root cause (current code)

`consumeAgentChatStream` in [`src/client/lib/agentStream.ts`](../../src/client/lib/agentStream.ts) calls `scrollToBottom()` on several SSE events (for example `text_delta` and `tool_args`) whenever `isActiveSession()` is true. There is **no** “user is pinned to bottom” check.

The scroll helper lives on the conversation surface, e.g. `AgentConversation` exports `scrollToBottom()` by setting `messagesEl.scrollTop = messagesEl.scrollHeight` ([`src/client/lib/agent-conversation/AgentConversation.svelte`](../../src/client/lib/agent-conversation/AgentConversation.svelte)).

## Expected

- **If the user has scrolled away from the bottom** (reading history), **do not** auto-scroll on new content. Preserve `scrollTop` / relative position as content grows (standard chat-app behavior).
- **If the user is at (or near) the bottom**, keep **sticky** follow mode: new tokens and tool updates keep the latest content in view.

Optional polish: when not pinned, show a discrete **“New messages”** or **“Jump to bottom”** control when content grows below the fold.

## Fix direction

1. Track whether the message list is **pinned to bottom** (threshold in px from `scrollHeight - clientHeight - scrollTop`), updated on user scroll / resize.
2. Pass a predicate or wrapped callback into `consumeAgentChatStream` so `scrollToBottom` runs only when pinned (and session is active), **or** implement scroll preservation when not pinned (e.g. adjust scrollTop by delta height when appending—more work but smoother).
3. Add a **regression test** where possible (component test or integration test that simulates scroll position + synthetic deltas).

## Related

- **[archived OPP-016](../opportunities/archive/OPP-016-agent-chat-draft-queue.md)** — other agent-chat resilience (drafting while busy); separate concern but same surface.

---

## Implementation plan

### Goal

Auto-scroll only when the user is **pinned to the bottom** (within a small pixel threshold). If they scroll up to read history, streaming updates must not call `scrollToBottom()`.

### 1. Pin state on the scroll container (`AgentConversation.svelte`)

- Bind or query the scrollable element (`messagesEl`) and track **`isPinnedToBottom`** (boolean), refreshed on:
  - `scroll` events on the messages container
  - `resize` (window or `ResizeObserver` on the container) so layout changes recompute pin state
- Define a helper `computePinned(el: HTMLElement, thresholdPx = 48): boolean`:
  - `el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx`
- On user scroll: if they scroll **up** away from the bottom, clear pin; if they scroll **to** the bottom, set pin.
- Export **`shouldAutoScroll(): boolean`** (or pass `getShouldAutoScroll` to parent) that returns `isPinnedToBottom` — alternatively export `scrollToBottomIfPinned()` that no-ops when not pinned (keeps call sites dumb).

### 2. Wire into `consumeAgentChatStream` (`agentStream.ts`)

- Extend `ConsumeAgentChatStreamOptions`: replace unconditional `scrollToBottom: () => void` with either:
  - **`scrollToBottom: () => void`** where the **caller** wraps: `() => { if (shouldPin()) conversationEl?.scrollToBottom() }`, or
  - **`scrollToBottomIfPinned: () => void`** provided by `AgentConversation` so the stream layer stays declarative.
- Replace every `if (isActiveSession()) scrollToBottom()` (events: `text_delta`, `tool_args`, `tool_start` non-title branch, `tool_end`) with the conditional variant so **only pinned** sessions auto-scroll.
- **Do not** change `thinking` (no scroll today) or `error` handling unless product wants it.

### 3. `AgentChat.svelte` call sites outside the stream

- Today `scrollToBottom()` is also invoked after send pipeline steps and in `finally` after stream ends (lines ~265, 286, 305, 318, 443). Decide per call site:
  - **Post-stream `finally`:** usually **always** scroll to bottom when the run completes (user expects to see the final answer) — keep unconditional **or** scroll if pinned **or** always scroll on completion (simplest: always scroll once when `streaming` becomes false for that session).
  - **Mid-send / optimistic paths:** align with “follow latest” — typically still scroll when user **just sent** (they expect to see their message + response); keep current behavior or tie to pin if we want parity.

Document the chosen rule in a one-line comment next to `finally`.

### 4. Optional polish (follow-up)

- When not pinned and new content arrives at the bottom, show a **“Jump to latest”** floating control (increment `unreadBelow` on delta when `!isPinnedToBottom`).

### 5. Tests

- **Unit:** pure function tests for `computePinned` math (mock `scrollHeight` / `scrollTop` / `clientHeight` via a stub object or extracted function in `agentStream` or a tiny `scrollPin.ts`).
- **`agentStream.test.ts`:** mock `scrollToBottom` → assert it is **not** called when the injected wrapper simulates “not pinned” (requires threading a `shouldScroll` getter into options — or test the wrapper in `AgentChat` via a thin exported helper). Minimum bar: extract `maybeScrollToBottom(isPinned, scroll)` and unit-test it.
- **Component / E2E (optional):** Playwright or Vitest + happy-dom with a scrollable div — higher cost; only if the team wants UI-level lock-in.

### 6. Acceptance

- Manual: start a long reply, scroll up mid-stream — viewport stays put; scroll to bottom — new tokens keep view at bottom.
- No change to transcript correctness or SSE handling — **scroll behavior only**.
