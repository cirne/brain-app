# BUG-018: Hub Resume does not unpause Your Wiki (background agent)

**Status:** Fixed (2026-04-24).

**Tags:** `hub`, `your-wiki`, `background-agent`

## Summary

After the user **pauses** the Your Wiki / background loop in **Brain Hub**, **Resume** did not return the agent to an **active** state; it could remain **paused** (in-app report: loop does not restart).

**Related in-app feedback:** issue **#1** — 2026-04-24, title *Resume does not restart paused background agent in Braintunnel hub* (staging). Cross-ref only; do not treat `reporter` in the source file as public documentation.

## Root cause

1. **Hub list** entries are mostly **`wiki-expansion`** runs (UUID ids). **`BackgroundAgentPanel`** always called **`/api/your-wiki/pause`** and **`/api/your-wiki/resume`**, so pause/resume never hit **`/api/background/agents/:id/pause|resume`** for those runs — resume could not clear `pausedRunIds` or restart the job.
2. **Your Wiki supervisor:** **`resumeYourWiki`** skipped **`supervisorLoop`** when **`loopRunning`** was still true while the previous loop was exiting (e.g. user **Resume** during **`await setPhase(..., paused)`** after enrich/cleanup). The loop still **`break`** after that await even if **`isPaused`** had been cleared.

## Fix

- **`BackgroundAgentPanel.svelte`:** route pause/resume by run kind — **`your-wiki`** → `/api/your-wiki/...`; **`wiki-expansion`** (and any other non–your-wiki id) → `/api/background/agents/:id/...`.
- **`yourWikiSupervisor.ts`:** **`kickSupervisorLoop`** (immediate + **`queueMicrotask`** retry) so resume starts after **`finally`** clears **`loopRunning`**; after **`await setPhase(..., paused)`**, **`continue`** the loop if the user resumed (**`!isPaused`**) instead of always **`break`**.

## Design context

[OPP-033: Wiki compounding / Karpathy alignment](../../opportunities/OPP-033-wiki-compounding-karpathy-alignment.md) states that **Resume** should start a **new lap** at enriching (not a mid-stream continuation). This bug was about **Resume having no effect** (still paused), not about lap semantics.

## Repro (from user report)

1. Open **Brain Hub**.
2. **Pause** the background agent (Your Wiki).
3. Click **Resume**.
4. **Observe:** agent stays **paused**; supervisor does not appear to run again.

## Expected

**Resume** clears pause and starts the supervisor or the correct wiki-expansion job, and Hub shows a **non-paused** running/idle-appropriate state consistent with the server.
