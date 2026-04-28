# BUG-028: Agent email draft wrong recipient (`To`) and signature identity

**Status:** Open  
**Tags:** `mail` · `draft` · `agent` · `privacy`  

**Related:** [OPP-056](../opportunities/OPP-056-email-draft-overlay-markdown-editor.md) (draft UI and single source of truth in overlay — orthogonal to LLM factual errors); [OPP-020](../opportunities/OPP-020-brain-owned-sending-address.md) (from-address product); [ripmail OPP-029](../../ripmail/docs/opportunities/OPP-029-compose-voice-context-from-sent-mail.md) (recipient-aware compose prompts — qualitative complement).

---

## Summary

When the user requested a draft addressed to an **explicit person**, the surfaced draft used **wrong recipient fields** (`To`/display name) and a **wrong signature / sender attribution** versus the signing identity configured for outbound mail. The user **corrected manually** before sending.

This is **semantic / identity fidelity** in **`draft`** or compose tooling: **not** purely a UI overlay gap (OPP-056).

---

## Repro (from feedback)

1. Prompt the assistant to compose mail to an explicit named recipient (e.g., organizational request).
2. Inspect `To` / signature block in the drafted body.
3. Observe mismatched recipient or sender attribution relative to **`me.md`** / mailbox identity context.

---

## Expected

Draft tooling should **prefer** authoritative sources (connected mailbox **`From`/`whoami`-class identity**, contact resolution for **`To`** when unambiguous from thread or `who`), and surface **confidence / ask** rather than hallucinating names.

---

## User feedback

- In-app issue **#13** (`2026-04-27`).
