# OPP-018: First Chat After Wiki Draft — Welcome Prompt and “Wow” Moment

## Problem

After onboarding produces a **first draft wiki** and the user lands in **Chat**, they see the **same standard agent UI** as every other session. Nothing signals that this moment is special: the assistant does not necessarily **introduce itself**, **anchor to what was just built**, or **do one proactive thing** that proves the product understands them.

Without a dedicated first-chat experience, the handoff from “we built your wiki” to “now talk to Brain” can feel like a cold reset—a generic coding assistant behind the same chrome—instead of a continuation of the same relationship.

## Vision

For the **very first chat** (operational definition below), use a **specific prompt**—system and/or first-turn behavior—so the assistant:

1. **Introduces itself** in Brain’s voice: what it is, that it has the wiki and tools, and how it can help *this* user.
2. **Connects to the artifact** the user just got: the draft wiki, profile (`wiki/me.md` / accepted onboarding output), and optionally what onboarding already inferred.
3. **Aims for a small “wow”**: one concrete thing the user did not have to ask for—something it **already knows** from the wiki, something it **discovers** with a single cheap tool pass (e.g. one ripmail search, one file highlight), or a **sharp first suggestion** tied to their stated projects or people.

The bar is not theatrical; it is **credible personalization** so the first reply feels like *their* assistant, not a blank template.

**Same UI:** This opportunity assumes we **keep** the default chat shell (no requirement for a new layout). The lever is **prompting and first-run behavior**, not a separate onboarding chat component—unless product later decides a distinct shell helps (see presentation notes in [OPP-014](./OPP-014-onboarding-local-folder-suggestions.md)).

## Relationship to other work

| Link | Why it matters |
| ---- | ---------------- |
| [OPP-006](./OPP-006-email-bootstrap-onboarding.md) | Defines email-first bootstrap, profile, and wiki seeding. First chat should read as the **next chapter** of that story. |
| [OPP-014](./OPP-014-onboarding-local-folder-suggestions.md) | If local folders were suggested and indexed, first chat can reference **files + mail** naturally. |
| [OPP-011](./OPP-011-user-skills-strategy.md) / [personal wiki](../product/personal-wiki.md) | Vocabulary and “what is a wiki here” should stay consistent with onboarding copy. |

Implementation detail already in code: the profiling path notes that **`wiki/me.md` is treated as identity context** for the main assistant—first chat should **explicitly** lean on that contract rather than assuming the model will always do it without prompting.

## Operational definition: “first chat”

Product needs a single clear rule, for example:

- **First thread** in the default agent chat after onboarding completes (no prior user messages in that workspace), or
- **First user-visible assistant turn** after `onboarding` state transitions to “done” / wiki ready,

whichever is easier to implement consistently. The doc does not prescribe the flag; it only requires **one** unambiguous trigger so repeat visits are not stuck on the welcome prompt forever.

## Implementation sketch

1. **Detect** first-chat eligibility server-side (or client with server validation) when creating or opening the default chat session.
2. **Inject** a **first-chat system supplement** (append to base agent system prompt) or a **structured first-turn instruction** so the model must:
   - greet and introduce Brain briefly;
   - reference that a wiki exists and where identity lives;
   - include **one** proactive element (see below) unless tools are unavailable or empty.
3. **Optional:** a **non-user “bootstrap” assistant message** is generally worse for UX than a single rich first reply to an empty thread or to a minimal seeded user line—product should prefer **one assistant message** that feels natural, not fake back-and-forth.
4. **Tools:** Allow the same tool surface as normal chat; the “wow” should stay **cheap** (bounded reads, no long autonomous loops) unless we explicitly expand scope later.

### Proactive “wow” patterns (examples, not requirements)

- Pull **one sentence** from `wiki/me.md` or a seeded page and reflect it back usefully.
- **One ripmail search** for a timely thread (e.g. recent project name from profile) and offer to summarize or draft.
- If [OPP-014](./OPP-014-onboarding-local-folder-suggestions.md) ran: mention **one folder or file type** that is now in scope.
- Surface **one wiki link** the user might open next (e.g. a person or project page that was just created).

## Experimentation and copy

**Prompt text is explicitly exploratory.** The right introduction will be found by **trying variants** (tone, length, how assertive the proactive step is) and seeing what **resonates** in real use.

Track loosely:

- Does the user send a second message quickly?
- Do they open wiki pages from the first reply?
- Qualitative feedback: “felt personal” vs “creepy” vs “generic”

When stable patterns emerge, fold the winning elements back into this doc (or a short product note) so engineering is not guessing from chat logs alone.

## Risks and guardrails

- **Overreach:** Proactive mail/file access must stay **transparent** (user already consented in onboarding; still avoid surprise exfiltration tone).
- **Failure modes:** Empty wiki, failed seeding, or missing tools should degrade to a **honest short intro** without fabricating personalization.
- **Repeat visits:** Guard the trigger so only the **first** eligible chat gets the special prompt.

## Non-goals

- Replacing the main agent system prompt for all sessions.
- A multi-step scripted tutorial inside chat (that is product onboarding, not this OPP).
- Guaranteeing a “magic” moment every time—only **raising the floor** for the first impression.
