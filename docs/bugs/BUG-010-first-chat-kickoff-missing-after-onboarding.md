# BUG-010: First-chat welcome kickoff missing after onboarding (desktop / clean setup)

**Status:** Open

## Symptom

After a **clean** onboarding flow, the user **reviews and accepts** their profile (continues from the review step), lands in the main **Assistant** view, and expects the **first-chat-after-onboarding** experience: the assistant **speaks first** with the **“First conversation”** guidance (warm greeting, reference `me.md`, one proactive insight — see OPP-018 / `assistantAgent.ts`).

Instead, the UI behaves like **plain default chat**: no automatic assistant open, or the user must type first; the experience does not match the designed post-onboarding kickoff.

## Expected behavior (design in repo)

There is **no separate “welcome agent”** — the main assistant is always used. The feature is implemented as:

1. **Server:** On `POST /api/onboarding/accept-profile`, `writeFirstChatPending()` writes a marker under Brain home. The next **`POST /api/chat`** to an **empty** persisted session consumes it and passes **`firstChat: true`** into `getOrCreateSession`, which appends the **First conversation** section to the system prompt.

2. **Client:** `finishOnboarding()` in `Onboarding.svelte` sets `sessionStorage` key `brain-fresh-chat-after-onboarding` to `1`. When `Assistant.svelte` mounts, it should run **`newChat()`** then **`sendFirstChatKickoff()`** (invisible user turn + `firstChatKickoff: true`).

If either path fails silently, the user only sees the default assistant shell.

## Likely causes (hypotheses)

1. **`sessionStorage` lost or never set** — e.g. session cleared between accept and main shell (`brain-*` keys cleared by dev hard-reset; webview/session lifecycle on quit; navigating to `/onboarding` “Open Brain” without going through `finishOnboarding()` does not set the flag).

2. **Kickoff errors swallowed** — `Assistant.svelte` wraps `sendFirstChatKickoff()` in `try/catch` with an empty catch, so a **400** (e.g. `first chat kickoff is not available` when the pending marker was already consumed or session not empty) produces **no user-visible error**.

3. **`agentChat` not ready within 16 `tick()` loops** — rare on slow devices; kickoff never runs.

4. **Legacy onboarding recovery** — the `seeding` / `confirming-categories` → `done` path calls `onComplete()` **without** setting `FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY`, so no client kickoff (server marker may still exist depending on path).

5. **Ordering / consumption** — any other `POST /api/chat` that hits an empty session first could consume `tryConsumeFirstChatPending()`; a subsequent `firstChatKickoff` request can fail the `firstChatKickoff && !firstChat` check.

## Dev repro URL (local)

With **`npm run dev`** (Vite on port **5173** by default), open:

**`/first-chat`** — full URL: `http://localhost:5173/first-chat`

Only when **`import.meta.env.DEV`** is true, the client:

1. `POST /api/dev/first-chat` — writes `first-chat-pending.json` under Brain home chat data, sets onboarding state to **`done`**, clears in-memory assistant sessions.
2. Sets `sessionStorage` key `brain-fresh-chat-after-onboarding` to `1`.
3. Replaces the URL with `/` so the main shell loads and `Assistant.svelte` runs the same **new chat + first-chat kickoff** path as after accepting a profile.

`POST /api/dev/*` is registered only when `NODE_ENV !== 'production'`. Production builds do not expose this endpoint.

For a profile-grounded first message, ensure **`wiki/me.md`** exists (e.g. after profiling or paste a minimal file).

## Fix direction

- **Surface failures:** log or show a non-blocking error when `sendFirstChatKickoff` returns non-OK instead of ignoring.
- **Resilience:** if `sessionStorage` is missing but `first-chat-pending.json` still exists, consider a one-time recovery (e.g. prompt or auto-kickoff when Assistant loads with empty chat and pending file). Alternatively, persist the “needs kickoff” intent in **`localStorage`** (survives less fragile than session-only) with a versioned key, or drive purely from server pending state when loading the main app after `state === done`.
- **Repro:** desktop clean install, accept profile, confirm whether `brain-fresh-chat-after-onboarding` is set before `/` load and whether the first `POST /api/chat` includes `firstChatKickoff: true` and succeeds.
- **Tests:** extend `chat.test.ts` / integration for kickoff + client mount path if feasible.

## Related files

- `src/client/lib/onboarding/Onboarding.svelte` — `finishOnboarding()`, `acceptProfile()`
- `src/client/lib/Assistant.svelte` — `FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY`, kickoff loop
- `src/client/lib/AgentChat.svelte` — `sendFirstChatKickoff()`
- `src/server/routes/onboarding.ts` — `accept-profile`, `writeFirstChatPending()`
- `src/server/lib/firstChatPending.ts` — pending marker on disk
- `src/server/routes/chat.ts` — `tryConsumeFirstChatPending`, `firstChatKickoff` validation
- `src/server/agent/assistantAgent.ts` — `firstChat` / `firstChatPromptSection()`
- `docs/opportunities/OPP-018-first-chat-post-onboarding-prompt.md` — product intent
