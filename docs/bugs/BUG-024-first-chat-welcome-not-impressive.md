# BUG-024 — First-chat welcome is flat and generic

**Status:** Open  
**Priority:** High (first impression)  
**Dev repro:** navigate to `http://localhost:3000/first-chat`

---

## What's happening

The first-chat welcome turn — the assistant's unprompted opening after onboarding — consistently under-delivers:

- Reads like a generic "Hi, I'm your assistant" intro instead of showing it already knows the user
- Ignores or superficially skims the inbox; doesn't surface specific actionable open loops
- Calendar check pulls in too many shared/family calendars that don't belong to the user and reads them as if they're the user's own events
- Does not end with meaningful `suggest_reply_options` chips — either skips them entirely or offers vague options like "Tell me more about your work"
- Prompt guidance exists (`first-chat.hbs`) but the cheap default model (gpt-5.4-mini) doesn't follow multi-step instructions reliably enough to execute the full scan → synthesize → chip flow

## Expected behavior

1. Scans wiki (`me.md` + recent files) and inbox (recent threads, open loops, unacted intros)
2. Opens with a warm one-liner, then 2–3 specific observations drawn from actual data
3. Each observation pairs with a concrete offer: draft a reply, write a meeting brief, research a topic, summarize a thread
4. Ends with `suggest_reply_options` chips that are specific offers to do real work — not "how can I help?"

## Root cause (working theory)

- The first-chat prompt is a multi-step instruction sequence appended to an already-long base prompt; smaller models consistently drop the final step (chips) or collapse the earlier steps into a surface skim
- The base `suggest_reply_options` reminder helps regular turns but the first-chat context is unusual enough (no user message, proactive mode) that the model doesn't apply it
- Calendar list_calendars + filter logic is too complex for one turn alongside inbox scanning and wiki reading

## Ideas to try

- Consider a dedicated first-chat agent that runs wiki + inbox scans *before* the assistant writes anything, then feeds the findings into a simpler "write the intro" prompt
- Or: run the first-chat turn with a stronger model (claude-sonnet or gpt-5.4) only for this one turn
- Simplify the prompt further — one concrete task per step, not a multi-step sequence
- Add an eval that checks: `suggest_reply_options` called, inbox tool called, final text contains a specific name or thread reference from the data
