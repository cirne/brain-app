# Archived: OPP-055 — Tap-to-talk mobile panel

**Archived 2026-04-30.** **Status: Implemented.** `ChatVoicePanel.svelte` + `voiceTapCapture.ts` + `UnifiedChatComposer.svelte`; `POST /api/transcribe` unchanged. **Stable URL:** [stub](../OPP-055-tap-to-talk-mobile-panel-ux.md).

---

# OPP-055: Tap-to-Talk Mobile Panel — Redesigned Voice UX

**Tags:** `mobile` · `chat` · `voice` · `ux`  
**Replaces:** hold-to-speak in [archived OPP-074](./OPP-074-press-to-talk-dev-only-feature-flag.md)  
**Continues:** [OPP-046 stub](../OPP-046-voice-input-press-to-talk-wispr-flow.md) / [archive](../archive/OPP-046-voice-input-press-to-talk-wispr-flow.md) (vendor/STT research)

---

## One-line summary

Replace hold-to-speak with a **tap-to-talk panel**: a fixed 80px bar at the bottom of the chat that surfaces a prominent mic button, animates the recording state, and reveals two contextual action buttons — **restart** and **cancel** — without shifting any other layout.

---

## Problem with hold-to-speak

The shipped dev-only implementation requires the user to hold a button throughout their utterance. On mobile:

- Holding a small button while forming a thought is cognitively awkward.
- Accidental release cuts the recording short with no recovery path.
- There is no restart (start over without cancelling entirely) — any mistake means cancelling and starting the whole flow again.
- The affordance gives no feedback that the system is actively listening other than the hold state itself.

Tap-to-talk is a fundamentally more natural interaction for a chat interface: you initiate with intent, speak freely with both thumbs off the screen, and commit when you're done.

---

## Proposed UX

### The panel

A fixed bottom bar, **80px tall**, sitting directly above the bottom safe area (notch / home indicator). It is always present when the voice feature is enabled on narrow viewports (mobile breakpoint), not just on empty threads.

The panel is distinct from the text composer: voice and text input are separate interaction modes. When the panel is visible, the text composer is accessible by scrolling up or tapping outside the panel — voice is not a replacement but a complement.

**Resting state (not recording):**

```
┌────────────────────────────────────┐  ← 80px panel
│                          [  🎤  ]  │
│                         primary btn│
└────────────────────────────────────┘
```

- The primary mic button sits in the **right** quadrant of the panel — where the thumb naturally rests on a phone held in portrait.
- Left two-thirds of the panel is empty, ready to receive action buttons when recording begins.
- Panel background: slightly frosted / translucent surface over the chat content, consistent with the existing chat chrome.

**Recording state (after first tap):**

```
┌────────────────────────────────────┐
│  [ ↺ restart ]  [ ✕ cancel ]  [ ● ]│
└────────────────────────────────────┘
```

- **Restart** and **Cancel** buttons appear in the left area. They do **not** push any existing layout — they animate in within the panel only.
- The primary button transforms to a **"done / submit"** state (filled circle, pulsing ring).
- Tapping **primary again** ends recording, submits audio for transcription, and clears the panel back to resting state.

---

## Button anatomy and appearance

### Primary button (mic / done)

**Resting:**

- Circle, ~52px diameter, filled with the app's accent color (brand blue / violet — whatever `--color-primary` resolves to).
- White microphone icon centered inside.
- Subtle drop shadow to lift it off the panel.
- Touch target extended to full panel height on the right side (~1/3 of panel width) for easy thumb reach.

**Recording:**

- Button fill transitions to a **warm red** (`~#E53E3E` or closest design-system equivalent) — universally understood as "active / stop."
- A soft **pulsing ring** animates outward from the button edge: a single ring that fades out, repeating every ~1.4 s. The ring color is a 40% opacity variant of the recording fill. This uses a CSS keyframe animation, no JavaScript required.
- The microphone icon swaps to a **filled square** (stop icon), signaling that tapping will finalize.
- The animation respects `prefers-reduced-motion`: when set, pulsing stops; the button simply remains the recording color.

### Restart button

- Smaller circle, ~38px, using the panel background with a subtle border — visually subordinate to the primary.
- Icon: counter-clockwise arrow (↺, Lucide `RotateCcw`).
- Label: `"Restart"` in small muted text below the icon (optional: hidden on very narrow viewports, icon-only with accessible `aria-label`).
- Tap behavior: immediately **discards the current recording**, restarts capture without returning to resting state. The primary button stays in recording mode. The pulsing animation resets.

### Cancel button

- Same size and style as Restart, using `RotateCcw`'s sibling — Lucide `X` icon.
- Label: `"Cancel"`.
- Tap behavior: **discards recording entirely**, no transcription call made. Panel returns to resting state. Chat state is exactly as it was before the user tapped the primary button.

---

## Animations and motion

All transitions use `transition` and `@keyframes` only — no animation library dependency.


| Transition                                        | Duration          | Easing            | Notes                                        |
| ------------------------------------------------- | ----------------- | ----------------- | -------------------------------------------- |
| Action buttons enter (restart + cancel)           | 180 ms            | `ease-out`        | Fade in + translate from left by ~8px        |
| Action buttons exit                               | 120 ms            | `ease-in`         | Fade out + translate back                    |
| Primary button color change (resting → recording) | 200 ms            | `ease`            | `background-color` + `box-shadow`            |
| Pulse ring expand                                 | 1400 ms           | `ease-out` (loop) | `scale` 1 → 1.6, `opacity` 0.4 → 0           |
| Primary button icon swap                          | crossfade, 150 ms | `ease`            | Use two overlapping icons; opacity crossfade |


The panel itself does **not** slide in or animate on load — it is always present in the DOM; only the child buttons animate. This avoids layout shifts and keeps the implementation simple.

---

## State machine

```
resting
  → tap primary → recording
      → tap primary → submitting → resting (transcription returned, text appended to composer or sent)
      → tap restart → recording (capture restarted, stay in recording state)
      → tap cancel → resting (no transcription, no change to chat)
  submitting (brief intermediate state while POST /api/transcribe is in flight)
      → success → resting (composer populated with transcript, or auto-sent if composer was empty)
      → error → resting (toast with error; no audio committed)
```

---

## Placement and layout rules

- Panel is **fixed** to the bottom of the viewport (CSS `position: fixed; bottom: 0`), above `env(safe-area-inset-bottom)`.
- It does **not** participate in the flex/grid layout of the chat column — it floats independently. The chat scroll area should have `padding-bottom` sufficient to prevent the last message from being hidden behind the panel.
- On viewports wider than the mobile breakpoint (≥768px or the app's `md:` threshold), the panel is **hidden** — voice is not targeted at desktop in this phase.

---

## Interaction with the chat composer

When a recording completes and transcription succeeds:

- If the **text composer is empty**: the transcript is placed in the composer and auto-submitted (same as the existing press-to-talk behavior — sends the message immediately).
- If the **text composer already has text**: the transcript is **appended** (space + transcribed text) so the user can review before sending. This avoids losing draft text.

This behavior matches user expectations: voice is additive, not destructive.

---

## Accessibility

- All three buttons have explicit `aria-label` attributes (`"Start recording"`, `"Stop and send"`, `"Restart recording"`, `"Cancel recording"`).
- The panel has `role="toolbar"` with `aria-label="Voice input"`.
- Pulsing animation is suppressed when `prefers-reduced-motion: reduce` is active.
- Color alone does not convey state: the icon changes in addition to the color.

---

## Implementation notes

### Component structure

```
ChatVoicePanel.svelte           ← new top-level panel component
  VoicePrimaryButton.svelte     ← mic / stop button with animation
  VoiceActionButtons.svelte     ← restart + cancel, conditionally rendered
```

`ChatVoicePanel` replaces `ChatComposerAudio.svelte` for the mobile path. The `pressToTalkEnabled.ts` guard stays in place — the panel only renders when voice is permitted.

### Audio capture

No change from the existing dev-mode capture path: `MediaRecorder` → blob → `POST /api/transcribe`. The restart action stops the existing `MediaRecorder` instance and starts a new one — same setup, different lifecycle trigger.

### Feature flag

The panel respects the same `pressToTalkEnabled` flag from OPP-074. When `false`, `ChatVoicePanel` renders nothing. When the feature graduates from dev-only (per OPP-046 vendor decisions), the flag source changes — the panel code does not need to change.

---

## Design details to resolve before build

1. **Panel background:** frosted glass (`backdrop-filter: blur`) vs a solid surface lifted with shadow. Frosted is more modern but has GPU cost on low-end devices — test on an older iPhone.
2. **Panel always-visible vs trigger-to-open:** this OPP proposes always-visible on mobile. An alternative is a single mic icon in the composer toolbar that expands into the panel. The always-visible version is simpler and more discoverable for a first implementation.
3. **Transcript placement (empty vs non-empty composer):** confirm the append vs auto-send split with a real-device test; some users may find auto-send surprising if they expected to review the transcript first. Consider a brief "send in 2s" countdown on the composer for the empty-composer case.
4. **Haptics:** `navigator.vibrate()` on tap and on recording start/stop, where supported. Low-effort delight on Android; no-op on iOS web.

---

## Non-goals (this OPP)

- Full-duplex voice (TTS response playback) — see OPP-046 long-term direction.
- Desktop voice UI.
- Wakeword / always-listening.
- Changing the STT vendor or transcription stack — that stays in OPP-046.

---

## Related

- [OPP-046](../OPP-046-voice-input-press-to-talk-wispr-flow.md) — STT vendor research, Wispr Flow vs alternatives; context injection.
- [OPP-074 (archived)](./OPP-074-press-to-talk-dev-only-feature-flag.md) — shipped dev gate; component history.
- [OPP-008 stub](../OPP-008-tunnel-qr-phone-access.md) — phone as primary client; same surface this UX targets.

