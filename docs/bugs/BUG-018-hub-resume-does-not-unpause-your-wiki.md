# BUG-018: Hub Resume does not unpause Your Wiki (background agent)

**Status:** Open

**Tags:** `hub`, `your-wiki`, `background-agent`

## Summary

After the user **pauses** the Your Wiki / background loop in **Brain Hub**, **Resume** does not return the agent to an **active** state; it can remain **paused** (in-app report: loop does not restart).

**Related in-app feedback:** issue **#1** — 2026-04-24, title *Resume does not restart paused background agent in Braintunnel hub* (staging). Cross-ref only; do not treat `reporter` in the source file as public documentation.

## Design context

[OPP-033: Wiki compounding / Karpathy alignment](../opportunities/OPP-033-wiki-compounding-karpathy-alignment.md) states that **Resume** should start a **new lap** at enriching (not a mid-run continuation). This bug is about **Resume having no effect** (still paused), not about lap semantics.

## Repro (from user report)

1. Open **Brain Hub**.
2. **Pause** the background agent (Your Wiki).
3. Click **Resume**.
4. **Observe:** agent stays **paused**; supervisor does not appear to run again.

## Investigation hints

- Server: `resumeYourWiki`, `pauseYourWiki`, `ensureYourWikiRunning` in `src/server/agent/yourWikiSupervisor.ts` (`isPaused` / `your-wiki/state.json`, `supervisorLoop`).
- Client: Hub controls and whether `**/api/your-wiki/resume`** (or equivalent) is called and SSE/state match server after resume.
- Distinguish: server correct but **UI** stuck on paused vs **API** not clearing persisted pause vs loop not starting.

## Expected

**Resume** clears pause and starts the supervisor (new lap at enriching per OPP-033), and Hub shows a **non-paused** running/idle-appropriate state consistent with the server.