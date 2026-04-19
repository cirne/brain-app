# Archived: OPP-016 (Draft / Queue While Agent Busy)

**Status: Deprioritized — archived.** The locked composer during streaming is a real UX friction point, but it has not been a top complaint in practice — users are generally watching the stream, not composing. Archived to keep the active queue lean; straightforward to implement when it becomes friction worth fixing.

**What was deferred:**
- Always-editable draft buffer in the chat input (even while streaming)
- Queue-or-replace policy for submitted follow-ups
- Visual distinction between "draft" and "sending/queued" states

**Why deprioritized:**
- Streaming turns tend to complete in seconds for most tasks; the window is short
- Server-side constraint (one active `prompt()` per session) still needs a queue or library-supported enqueue before the client side matters
- Other priorities (onboarding, calendar, sources) have higher leverage

**If reopened:** Check BUG-006 for the server-side concurrent-prompt constraint first; the client draft buffer is trivial once the server queue is in place.

---

# OPP-016: Draft and queue follow-up messages while the agent is busy

## Problem

Today, when a session is **streaming** (`streaming: true`), the composer is **disabled** and `send` bails out if another turn is in flight ([`src/client/lib/AgentChat.svelte`](../../src/client/lib/AgentChat.svelte): `disabled={streaming}`, early return when `st.streaming`).

That blocks a common workflow: **compose your next message** while the model is still thinking or streaming—then **send** when the turn completes (or apply a defined policy for mid-run steering).

## Motivation

- Reduces friction: users think ahead without staring at a locked input.
- Aligns with how other chat products behave: typing is allowed; **sending** may still be gated by policy.
- Complements server-side constraints documented in **[BUG-006](../bugs/archive/BUG-006-agent-concurrent-prompt.md)** (one active `prompt()` per session unless we queue or use pi-agent-core `steer()` / `followUp()`).

## Proposed direction

1. **UI:** Keep a **draft buffer** always editable. Visually distinguish "draft" vs "sending." Optionally show **queued messages** with clear order.
2. **Send behavior:** When the user submits while busy:
   - **Queue** the text and auto-send when the current stream completes, **or**
   - **Single slot:** replace pending follow-up, **or**
   - Integrate **steer** / **followUp** if product wants true mid-run injection
3. **Server:** Whatever the product chooses must stay consistent with **[BUG-006](../bugs/archive/BUG-006-agent-concurrent-prompt.md)**—no overlapping `prompt()` on the same session without a queue.

## Related

- **[BUG-006](../bugs/archive/BUG-006-agent-concurrent-prompt.md)** — concurrent `prompt()` and possible use of `steer()` / `followUp()`.
- **[BUG-007](../bugs/BUG-007-agent-view-scroll-stick-to-bottom.md)** — scroll behavior while streaming in the same agent view.
