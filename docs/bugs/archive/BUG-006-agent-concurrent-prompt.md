# BUG-006: “Agent is already processing a prompt” on concurrent chat sends

**Status: fixed (2026-04-17).** `await agent.waitForIdle()` immediately before `agent.subscribe()` in [`streamAgentSseResponse`](../../../src/server/lib/streamAgentSse.ts) serializes overlapping `POST /api/chat` (and onboarding) handlers for the same in-memory `Agent`. Tests: [`streamAgentSse.test.ts`](../../../src/server/lib/streamAgentSse.test.ts).

## Symptom

- SSE `error` event (or surfaced in UI) with message:
  - `Error: Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion`
- Often after sending a second message in the same chat **before** the first reply finishes (double submit, slow network retry, or two tabs on the same session).

## What the error means

[`@mariozechner/pi-agent-core`](https://www.npmjs.com/package/@mariozechner/pi-agent-core)’s `Agent` allows **at most one active run** at a time (`activeRun` in `dist/agent.js`). Calling `prompt()` while a run is still in progress throws this error.

Brain wires each persisted `sessionId` to a **single in-memory** `Agent` (`getOrCreateSession` in `src/server/agent/index.ts`). Each `POST /api/chat` calls `agent.prompt(...)` in `streamAgentSseResponse` (`src/server/lib/streamAgentSse.ts`). There is **no per-session lock or queue**: two overlapping requests for the same session hit the same `Agent` and the second `prompt()` throws.

## What `steer()` and `followUp()` are (pi-agent-core)

These are **not** Brain-specific APIs; they come from pi-agent-core’s `Agent` class (see `node_modules/@mariozechner/pi-agent-core/dist/agent.js`).

| Method | Role |
| ------ | ---- |
| **`steer(message)`** | Enqueues a user message on the **steering** queue. The running agent loop can **drain** this queue and inject messages **during** the run (e.g. after the current assistant turn), so the user can redirect the model mid-flight. |
| **`followUp(message)`** | Enqueues a message on the **follow-up** queue, intended to run **after** the agent would otherwise stop (another drain point in the loop). |

Both queue messages **without** starting a new `prompt()` call. The library’s error text points authors of *integrations* toward these when they need to add user input while a run is active.

Brain’s chat path **does not** use `steer()` / `followUp()` today: it always uses `prompt()` for each user turn. So the error is not “you should have called `steer` instead” from product semantics alone—it indicates **concurrent `prompt()` calls on the same session**, which the current server design does not handle.

## Expected

- Either only one turn runs at a time per session (subsequent messages wait in a server-side queue), or
- The client reliably blocks duplicate sends until the stream completes, **and** the server still rejects or queues overlapping requests defensively (tabs, retries).

## Fix direction

1. **Server: serialize** `prompt()` (or the whole SSE handler) per `sessionId`—mutex, async queue, or “409 / retry” when busy.
2. **Client:** ensure the send control stays disabled for the full stream lifecycle (and consider idempotency / debounce) so normal use does not double-post.
3. **Optional / later:** evaluate whether product wants true mid-run steering via `steer()` / `followUp()` vs. always finishing one `prompt()` before the next; that would be a larger behavior change than (1)+(2).

## References

- `src/server/agent/index.ts` — `sessions` map, `getOrCreateSession`
- `src/server/routes/chat.ts` — `POST /api/chat` → `streamAgentSseResponse`
- `src/server/routes/onboarding.ts` — same pattern: `getOrCreateProfilingAgent(sessionId)` + `streamAgentSseResponse` (separate `Agent` map in `onboardingAgent.ts`, but **same concurrency bug** if two requests share one onboarding `sessionId`)
- `src/server/lib/streamAgentSse.ts` — `await agent.prompt(...)` (single choke point for wrapping / serializing)
- `@mariozechner/pi-agent-core/dist/agent.js` — `prompt`, `steer`, `followUp`, `activeRun`

## For implementers (later)

- **Scope:** Any fix that serializes `prompt()` should cover **both** main chat and onboarding profiling flows, or document why onboarding is exempt (e.g. UI never double-posts there).
- **Client:** Find chat send/stream lifecycle in `src/client/` (AgentChat / chat session store) and confirm whether the composer is disabled for the full SSE; grep for `POST` to `/api/chat` or stream consumers.
- **Server strategy (pick one):** (a) **FIFO queue** per `sessionId`—second request waits until `agent.waitForIdle()` then runs `prompt()`; (b) **reject busy** with HTTP 409 + clear JSON so the client can show “still replying”; (c) both—queue in server + hard-disable in UI.
- **Tests:** Prefer a route-level or `streamAgentSseResponse` test: two overlapping `POST /api/chat` with the same `sessionId` should **not** throw; assert second completes after first or gets 409, depending on chosen behavior.
- **Delete session:** `deleteSession` in `index.ts` should remain consistent with any per-session lock/queue (clear queue on delete if you add one).
