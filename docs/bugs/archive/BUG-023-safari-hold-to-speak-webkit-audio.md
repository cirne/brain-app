# BUG-023: Hold-to-speak / WebKit — silent or broken capture (Safari desktop and iOS)

**Status:** **Archived (2026-05-15).** Fixed or cannot reproduce on current Safari / WebKit and client workarounds.

**Was:** Open (investigation paused; workarounds in code; no NDJSON debug instrumentation in tree).

## Symptom

- **Safari (desktop) and iOS / Simulator:** Hold-to-speak can produce **all-zero or near-zero PCM** (digital silence) for the whole hold, or `**MediaStreamTrack` already `ended`** before any real audio, so **Whisper** returns nonsense (e.g. a single word like “you”) or the client shows an error.
- **Chrome (desktop):** Transcription can work but may **take longer to process**; not the same failure mode as Safari/WebKit.
- Affects the **mobile-style hold control** and the **Audio conversation / `hearReplies`** gating path, not only iPhone.

## Context (product)

- **Server:** `POST /api/transcribe` (OpenAI STT) with `temperature: 0`, optional `BRAIN_STT_LANGUAGE`.
- **Client:** `AgentHoldToSpeak.svelte` — `getUserMedia` with `HOLD_TO_SPEAK_AUDIO_CONSTRAINTS` (mono, echo cancellation, etc.).
- **WebKit path:** `preferPcmHoldCapture()` → `holdToSpeakPcmWav.ts` — `AudioContext` + **ScriptProcessor** (legacy) to build **mono PCM + WAV** because `**MediaRecorder` often yields empty blobs** on iOS WebKit.
- **Chrome path:** `MediaRecorder` with MIME fallbacks, timeslice where needed, `onstop` + microtask / delayed finalize for last chunks.

## Hypotheses explored (and what evidence suggested)

1. **H-A / H-B (gating + `holdGated`):** `ChatComposerAudio` uses `holdGated={!hearReplies}`. A `**$effect` in `AgentHoldToSpeak`** runs when `holdGated` is true: it **aborts arming, stops the session, and `track.stop()`**. If `hearReplies` was **falsely false**, the track could be **ended** while the user was still holding, producing **silence** or `**readyState: "ended"`** on the first audio block.
2. **Transient missing session row:** `hearReplies` was derived as `sessions.get(displayedSessionId)?.hearReplies ?? false`. When the Map briefly had **no row** for the displayed id, `hearReplies` became **false** → **holdGated true** → **mic torn down** — race between UI, `chatSessionStore`, and hold lifecycle.
3. **H-C / H-D / H-E (pointer / phase / `MediaRecorder`):** Releasing during **arming**, **duplicate finalize**, or **WebKit `onstop` / `ondataavailable` ordering** — addressed with `pendingRelease`, `finalizeStarted`, `requestData` + microtask / timeout completion paths (still relevant; not Safari-silence root cause alone).
4. **H-P / T-A / T-B / T-C (PCM path):** ScriptProcessor timing, **AudioContext** `resume`, max-sample cap, `onaudioprocess` after `closed` — used to see whether the graph ran at all vs. **pre-stopped track**.
5. **H-Q (garbage to Whisper):** If buffers were all zeros, uploading **long silent WAVs** still produced **low-signal** STT. **Client-side near-zero RMS** check (with duration threshold) was added to **skip upload** and show a user-facing hint instead of nonsense transcripts.
6. **H-R (immediate bad `getUserMedia` result):** If **any audio track is not `live`** right after `getUserMedia`, stop, show error, and avoid starting PCM/MediaRecorder (defensive; helps distinguish **instant** failure).

## What we changed (workarounds, not a full WebKit fix)


| Area                                                    | Change                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**AgentChat.svelte` — `hearReplies` for the composer** | `**hearRepliesForChatComposer`:** if there is **no** session row for the displayed id, treat as **on** (do **not** default to `false`), so a **missing key** does not set `holdGated` and kill the mic. **Only** a **present** row with `**hearReplies === false`** should gate. Comment in source explains the race. |
| `**holdToSpeakPcmWav.ts`**                              | **PCM + WAV** path for WebKit; stereo → mono downmix helpers; no ScriptProcessor worklet (portability).                                                                                                                                                                                                               |
| `**holdToSpeakMedia.ts`**                               | MIME order, `preferPcmHoldCapture` for WebKit, pending-release delay, filename `.wav` for PCM blobs, etc.                                                                                                                                                                                                             |
| `**AgentHoldToSpeak.svelte`**                           | `pendingRelease` while arming, WebKit `MediaRecorder` `onstop` ordering, **near-zero RMS** reject for PCM, **gUM** post-check for non-`live` tracks.                                                                                                                                                                  |
| **Server**                                              | `openAiStt.ts` temperature 0, optional language from env.                                                                                                                                                                                                                                                             |


**Not solved:** **Safari can still** deliver a **live** track that **taps to silence** (or still races with gating in edge cases) — **revisit** with Safari Web Inspector **audio** / **getUserMedia** / **user gesture** policy and possible **AudioContext**-scoped mic handling.

## Debug instrumentation (removed 2026-04-25)

- **NDJSON / HTTP ingest** (`127.0.0.1:7497/ingest/...`, session `ab5ba5`) in `**AgentHoldToSpeak.svelte`** (`_HOLD_DBG`) and `**holdToSpeakPcmWav.ts`** (`_PCM_DBG`).
- Re-add targeted logs or Safari timeline if this bug is picked up again.

## Files to revisit

- `src/client/lib/AgentChat.svelte` — `hearRepliesForChatComposer`, `holdGated` prop wiring
- `src/client/lib/AgentHoldToSpeak.svelte` — gating effect, gUM, PCM vs MediaRecorder, RMS guard
- `src/client/lib/holdToSpeakPcmWav.ts` — capture graph
- `src/client/lib/holdToSpeakMedia.ts` — platform detection and MIME strategy
- `src/server/lib/openAiStt.ts` — STT request defaults

## Repr (when resuming)

1. Safari (desktop) or iOS: enable **Audio conversation** / `hearReplies`, use **hold to speak** for several seconds.
2. Observe: silent transcript, `ended` track, or “no audio / near-zero RMS” client hint.
3. Compare same flow in Chrome.