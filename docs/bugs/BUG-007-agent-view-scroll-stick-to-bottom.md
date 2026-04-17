# BUG-007: Agent view scrolls to bottom on every stream delta while reading history

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

- **[OPP-016](../opportunities/OPP-016-agent-chat-draft-queue-while-busy.md)** — other agent-chat resilience (drafting while busy); separate concern but same surface.
