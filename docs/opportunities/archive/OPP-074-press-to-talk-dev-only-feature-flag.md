# Archived: OPP-074 (Press-to-talk — dev-only feature flag)

**Status: Shipped — archived (2026-04-25).** Hold-to-speak was originally gated to **local Vite dev** (`import.meta.env.DEV`) in composer audio; `POST /api/transcribe` returned **503** `transcribe_dev_only` when `NODE_ENV === 'production'`. Tests cover the helper and route. **As of 2026-04:** client + server guards were relaxed (`pressToTalkEnabled.ts`, `transcribeHttpAllowed.ts`) so voice can run in production when STT keys exist. **Voice UX / Wispr research:** [stub](../OPP-046-voice-input-press-to-talk-wispr-flow.md); full write-up [archive/OPP-046-voice-input-press-to-talk-wispr-flow.md](./OPP-046-voice-input-press-to-talk-wispr-flow.md); tap-to-talk polish **[OPP-055](../OPP-055-tap-to-talk-mobile-panel-ux.md)** (active).

**Code:** `src/client/lib/pressToTalkEnabled.ts`, `src/client/components/ChatVoicePanel.svelte`, `src/client/lib/voiceTapCapture.ts`, `src/server/lib/llm/transcribeHttpAllowed.ts`, `src/server/routes/transcribe.ts`.

---

# OPP-074: Press-to-talk — dev-only feature flag (ship guardrail)

**Status:** ~~Open~~ → **Shipped** (see archive banner above)  
**Tags:** `chat` · `mobile` · `quality` · `shipping`

## Summary

Gate **hold-to-speak / press-to-talk** (composer voice input that posts to `/api/transcribe`) behind a **feature flag that is on only in local dev** (`npm run dev` / Vite `import.meta.env.DEV`). **Default off** for production builds, packaged **Braintunnel.app**, and hosted staging—because the current experience is **too flaky** to expose to end users until reliability, permissions, and edge cases are addressed.

## Problem

- Press-to-talk depends on browser capture, network, and STT; failures surface as **silent drops, partial text, or confusing UI**—bad for first impressions and support load.
- Shipping it broadly without a guardrail risks **regression in every release** even when the team is not actively iterating on voice.
- A future **product** toggle (Hub / settings) may still make sense ([OPP-046](../OPP-046-voice-input-press-to-talk-wispr-flow.md) stub, **[OPP-055](../OPP-055-tap-to-talk-mobile-panel-ux.md)**); this OPP preserved the **near-term engineering** rule: **no voice affordance outside dev** until explicitly re-enabled (since relaxed — see banner).

## Proposed direction

1. **Single source of truth** for “voice UI allowed” on the client, e.g. `import.meta.env.DEV` (or a dedicated `import.meta.env.VITE_PRESS_TO_TALK` that defaults **false** and is set **true** only in dev server config—avoid ad-hoc checks scattered across `AgentHoldToSpeak`, `ChatComposerAudio`, `AgentChat`). **Done:** `pressToTalkEnabled.ts` + `ChatComposerAudio`.
2. **Server optional hardening (nice-to-have):** reject or no-op `POST /api/transcribe` when not in dev, so direct API abuse does not bypass the UI—only if product agrees STT has **no** legitimate non-dev caller yet. **Done:** `transcribeHttpAllowed.ts` + route guard.
3. **Tests:** client unit or component test that the hold-to-speak control is **absent** when `DEV` is false (or env flag off); dev fixture confirms **present** when on. **Done:** `pressToTalkEnabled.test.ts`, `ChatComposerAudio.test.ts`, `transcribeHttpAllowed.test.ts`, `transcribe.test.ts`.
4. **Documentation:** one line in [AGENTS.md](../../../AGENTS.md) or chat UX notes that press-to-talk is **dev-only** until this OPP is closed or superseded—only if a doc already lists composer features (avoid new markdown unless needed). **Skipped** (not required for closure).

## Non-goals

- Replacing Wispr/Web Speech research and vendor choice ([OPP-046](../OPP-046-voice-input-press-to-talk-wispr-flow.md) stub / [full archive](./OPP-046-voice-input-press-to-talk-wispr-flow.md)), mobile polish (**[OPP-055](../OPP-055-tap-to-talk-mobile-panel-ux.md)**).
- **Permanent** removal of voice; the flag should flip to a real product default once quality bar is met.

## Related

- [OPP-046](../OPP-046-voice-input-press-to-talk-wispr-flow.md) (stub) / [archive](./OPP-046-voice-input-press-to-talk-wispr-flow.md) — press-to-talk product direction and stack research (archived 2026-04-30).

## Acceptance

- No press-to-talk UI in **production** client bundles.
- Local **`npm run dev`** still allows iteration without extra env ceremony (or documents a single `VITE_*` if stricter control is preferred).
- Tests green; `npm run lint` clean for touched files.
