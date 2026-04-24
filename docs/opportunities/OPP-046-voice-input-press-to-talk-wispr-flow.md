# OPP-046: Voice input — press-to-talk on mobile (Wispr Flow / “Whisper Flow”)

**Status:** Open  
**Tags:** `mobile` · `chat` · `hosted` (API keys / vendor access)

## Summary

Add **hold-to-dictate** in the main chat so phone users can speak prompts instead of typing. Target UX: a **large, obvious “press to talk” (press-and-hold)** control—either on the **empty thread** state or **immediately above the message input** on narrow viewports—so discovery and thumb reach are effortless.

## Problem

- On mobile, long assistant prompts are **slow and error-prone** to type; voice is the natural modality when walking or one-handed.
- Browser/OS dictation is inconsistent across devices and does not understand **Braintunnel context** (thread, assistant, wiki names).
- Users may mention “**Whisper Flow**” colloquially; product research should evaluate [**Wispr Flow**](https://api-docs.wisprflow.ai/introduction)’s **Voice Interface API** (STT tuned for “magical” dictation, optional **application type `ai`**, chat-style **context** for names and thread history) versus **browser Web Speech API**, **on-device** models, or other vendors.

**Naming note:** [Whisper Flow](https://whisperflow.org/) (consumer “AI voice keyboard” on iOS/macOS) is a different product from **Wispr Flow**’s developer API. This OPP is about **in-app** dictation into the composer, not requiring users to install a separate keyboard app—though their UX (tap → speak → release) is a good **benchmark** for smoothness.

## Proposed direction

1. **UX (non-negotiable for v1)**
   - **Primary control:** one large affordance, e.g. “Hold to talk” with mic icon, **minimum ~44pt** touch target, clear **recording** state (pulsing ring, color, haptic if available on web).
   - **Placement (pick one for MVP, A/B the other):**
     - **Empty chat:** center-stage button when there are no messages, **or**
     - **Above composer:** fixed row between transcript and `textarea`, always visible on `max-width` breakpoints that match the mobile shell.
   - **Release to commit:** on pointer/touch **up**, stop capture, run transcription, **append or replace** draft text in the composer (product choice: always append vs replace if empty only).
   - **Cancel:** drag away or secondary “Cancel” if we need to avoid accidental sends (optional v1.1).

2. **Stack (to validate in spike)**
   - **Wispr Flow** documents WebSocket streaming (`/ws`) and REST `POST` with **base64, 16 kHz PCM WAV**; browser `MediaRecorder` typically yields **webm** → convert (e.g. [wavtools](https://github.com/convert-audio/wavtools) or server-side transcode) before calling the API.
   - **Auth:** prefer **short-lived client tokens** issued by our backend (see Wispr [client-side auth](https://api-docs.wisprflow.ai/)) to avoid routing all audio through Node for latency; if Wispr access is **enterprise-gated**, fall back to **server-proxied** calls with a server-only API key until approved.
   - **Context:** pass `context.application.type: "ai"` and, when available, **recent messages / conversation id** so names and disfluencies match user intent (per Wispr request schema).
   - **Fallback:** if Wispr is unavailable, optional **Web Speech API** or “type instead” with no dead-end.

3. **Privacy & settings**
   - **Opt-in** or first-use permission explainer; clear indication when audio leaves device (third-party STT).
   - Hub or Settings toggle: **Enable voice input** (default on after consent, TBD).

## Non-goals (initially)

- **Full duplex voice assistant** (TTS, interruptible playback) — separate epic unless dictation ships first.
- **Background continuous listening.**
- Replacing the **desktop** experience (focus v1 on **touch / narrow** layouts).

## Related

- [OPP-008](OPP-008-tunnel-qr-phone-access.md) — phone as first-class client; same surfaces benefit from low-friction input.
- [OPP-021](OPP-021-user-settings-page.md) / Hub — natural home for a **Voice** toggle and privacy copy.
- [OPP-043](OPP-043-google-oauth-app-verification-milestones.md) — if additional third-party data processing requires disclosure updates, align privacy policy and consent timing.

## Open questions

- **Vendor lock-in vs neutral abstraction:** single Wispr integration vs a thin `TranscriptionProvider` interface for local Whisper / Apple Speech later.
- **Cost model:** per-minute pricing, free tier limits, and whether **hosted** staging uses a shared key vs per-tenant.
- **Offline:** required for any tier, or explicitly online-only for v1.

## References (external)

- [Wispr Flow — Voice Interface API (introduction)](https://api-docs.wisprflow.ai/introduction)
- [Wispr Flow — Request schema (context, `ai` app type)](https://api-docs.wisprflow.ai/request_schema)
- [Wispr Flow — Quickstart (audio format, web recording)](https://api-docs.wisprflow.ai/quickstart)
