# Archived: OPP-018 (First Chat After Wiki Draft)

**Status: Deprioritized — archived.** The main agent already reads `wiki/me.md` and produces personalized responses from the first message. The dedicated "first-chat wow moment" prompt engineering is a polish improvement, not a blocker. Archived to keep the active queue lean; straightforward to implement as a prompt tweak when the onboarding flow is more stable end-to-end.

**What exists today:**
- `wiki/me.md` is injected into the main agent system prompt — first responses are already grounded in user identity
- No explicit "first-chat" detection or special prompt supplement
- No proactive "wow" step (tool call on behalf of the user in the first turn)

**What was deferred:**
- First-chat eligibility flag (server-side detection after onboarding completes)
- Per-session first-chat system supplement injected once
- One bounded proactive tool pass (e.g. one ripmail search for a timely thread from `wiki/me.md`)
- Experimentation framework to tune intro tone and length

**If reopened:** This is a prompt-engineering + one small server flag. Fast to ship; the design here is complete. Do it after onboarding is stable and we want to improve first-impression metrics.

---

# OPP-018: First Chat After Wiki Draft — Welcome Prompt and "Wow" Moment

## Problem

After onboarding produces a **first draft wiki** and the user lands in **Chat**, they see the **same standard agent UI** as every other session. Nothing signals that this moment is special: the assistant does not necessarily **introduce itself**, **anchor to what was just built**, or **do one proactive thing** that proves the product understands them.

Without a dedicated first-chat experience, the handoff from "we built your wiki" to "now talk to Brain" can feel like a cold reset—a generic coding assistant behind the same chrome—instead of a continuation of the same relationship.

## Vision

For the **very first chat**, use a **specific prompt** so the assistant:

1. **Introduces itself** in Brain's voice: what it is, that it has the wiki and tools, and how it can help *this* user.
2. **Connects to the artifact** the user just got: the draft wiki, profile, and what onboarding inferred.
3. **Aims for a small "wow"**: one concrete thing the user did not have to ask for—something it already knows from the wiki, a single cheap tool pass, or a sharp first suggestion.

**Same UI:** The lever is **prompting and first-run behavior**, not a separate layout.

## Implementation sketch

1. **Detect** first-chat eligibility server-side when creating or opening the default chat session.
2. **Inject** a **first-chat system supplement** (append to base agent system prompt) so the model:
   - greets and introduces Brain briefly
   - references that a wiki exists and where identity lives
   - includes **one** proactive element (bounded reads, no long loops)
3. Guard the trigger so only the **first** eligible chat gets the special prompt.

### Proactive "wow" patterns (examples)

- Pull **one sentence** from `wiki/me.md` and reflect it back usefully.
- **One ripmail search** for a timely thread (e.g. recent project name from profile) and offer to summarize.
- Surface **one wiki link** the user might open next (a person or project page just created).

## Experimentation and copy

Prompt text is explicitly exploratory. Track:
- Does the user send a second message quickly?
- Do they open wiki pages from the first reply?
- Qualitative: "felt personal" vs "creepy" vs "generic"

## Related

- [OPP-006](./OPP-006-email-bootstrap-onboarding.md) — defines the onboarding this follows
- [OPP-014](./OPP-014-onboarding-local-folder-suggestions.md) — if local folders were indexed, first chat can reference them
