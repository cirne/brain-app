# OPP-016: Draft and queue follow-up messages while the agent is busy

## Problem

Today, when a session is **streaming** (`streaming: true`), the composer is **disabled** and `send` bails out if another turn is in flight ([`src/client/lib/AgentChat.svelte`](../../src/client/lib/AgentChat.svelte): `disabled={streaming}`, early return when `st.streaming`).

That blocks a common workflow: **compose your next message** while the model is still thinking or streaming—then **send** when the turn completes (or apply a defined policy for mid-run steering).

## Motivation

- Reduces friction: users think ahead without staring at a locked input.
- Aligns with how other chat products behave: typing is allowed; **sending** may still be gated by policy.
- Complements server-side constraints documented in **[BUG-006](../bugs/BUG-006-agent-concurrent-prompt.md)** (one active `prompt()` per session unless we queue or use pi-agent-core `steer()` / `followUp()`).

## Proposed direction

1. **UI:** Keep a **draft buffer** always editable (or editable whenever we decide policy allows). Visually distinguish “draft” vs “sending.” Optionally show **queued messages** (one or many) with clear order.
2. **Send behavior:** When the user submits while busy:
   - **Queue** the text and auto-send when the current stream completes, **or**
   - **Single slot:** replace pending follow-up, **or**
   - Integrate **steer** / **followUp** if product wants true mid-run injection (larger behavior change; see BUG-006).
3. **Server:** Whatever the product chooses must stay consistent with **[BUG-006](../bugs/BUG-006-agent-concurrent-prompt.md)**—no overlapping `prompt()` on the same session without a queue or library-supported enqueue APIs.

## Related

- **[BUG-006](../bugs/BUG-006-agent-concurrent-prompt.md)** — concurrent `prompt()` and possible use of `steer()` / `followUp()`.
- **[BUG-007](../bugs/BUG-007-agent-view-scroll-stick-to-bottom.md)** — scroll behavior while streaming in the same agent view.
