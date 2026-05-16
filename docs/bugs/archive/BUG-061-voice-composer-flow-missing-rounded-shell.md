# BUG-061: Voice composer (`composer-flow`) loses rounded input shell while mic is on

**Status:** **Fixed (2026-05-16).**  
**Tags:** `client` · `chat` · `voice` · `ux`

**Related:** [archived OPP-055](../opportunities/archive/OPP-055-tap-to-talk-mobile-panel-ux.md) · [`UnifiedChatComposer.svelte`](../../src/client/components/UnifiedChatComposer.svelte) · [`ChatVoicePanel.svelte`](../../src/client/components/ChatVoicePanel.svelte) · [`AgentInput.svelte`](../../src/client/components/AgentInput.svelte)

---

## Summary

When the user enters **audio / voice input** from the unified chat composer (mic on, `composer-flow` layout), the **input widget loses the normal chrome**: no **rounded borders**, wrong **layout** vs text mode. Text mode uses `AgentInput`’s `input-shell` (`rounded-md border border-border …`); voice mode swaps in `ChatVoicePanel` with `border-none` and no matching shell on the parent `composer-input-shell`.

---

## Repro (from in-app feedback **#20**)

1. Enable audio / voice input (microphone on).
2. Observe the composer area.
3. **Actual:** flat panel, missing rounded border, layout misaligned.
4. **Expected:** same visual frame as text composer (rounded border, consistent height/alignment).

---

## Fix (2026-05-16)

Voice mode now mirrors keyboard composer chrome:

- **`UnifiedChatComposer`** wraps `ChatVoicePanel` in the same **`input-shell`** as `AgentInput`.
- **`composer-flow`** uses **`input-composer`** with **`lead-actions`** (keyboard / cancel / restart), center (timer + waveform), and **`send-actions`** (primary only, flush right).
- **`VoicePrimaryButton`** / **`VoiceActionButtons`** use embedded variants aligned with `send-btn` and lead-rail cells (no floating dock chips in composer).

**Verification:** User-confirmed UI; structural source checks in `UnifiedChatComposer.test.ts` and `ChatVoicePanel.test.ts`.

---

## User feedback

- In-app issue **#20** (`2026-05-16T16:14:53.507Z`).
