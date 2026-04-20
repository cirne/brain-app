# BUG-011: Background wiki expansion and seeding agent lack injected `me.md` context

**Status:** Open

## Symptom

After the user **accepts their profile**, **background wiki expansion** ([`wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts) → [`getOrCreateSeedingAgent`](../../src/server/agent/seedingAgent.ts)) runs with a kickoff message that tells the model to **anchor on `me.md`**, but the **accepted markdown is not present** in the model context for that run.

The **main assistant** injects the full **`me.md`** body via [`meProfilePromptSection`](../../src/server/agent/assistantAgent.ts); the **seeding** system prompt explicitly **omits** wiki `read` / `grep` / `find` and says to rely on **mail tools + task context**. For **interactive** `/api/onboarding/seed`, the user message supplies some context. For **background expansion**, the only user turn is the fixed expansion string—**no `me.md` text**—so the model must **guess** the profile from mail or hallucinate structure.

## Expected behavior

Any agent run whose instructions say “treat **`me.md`** as canonical” or “anchor on what they accepted” must receive **`me.md` contents** in the **system prompt** or **first user message**, unless a wiki **read** tool is enabled for that path.

## Likely fix direction

- Reuse or mirror [`meProfilePromptSection`](../../src/server/agent/assistantAgent.ts) (or `readFile` of `wiki/me.md` at agent creation) inside [`buildSeedingSystemPrompt`](../../src/server/agent/seedingAgent.ts) **when** building agents used for **wiki expansion**, **or** prepend the file body to the first [`agent.prompt`](../../src/server/agent/wikiExpansionRunner.ts) in `runWikiExpansionJob`.
- Ensure **interactive seeding** still behaves correctly if the user relies on accepted profile without pasting it.

## Relationship

- **Umbrella / roadmap:** [OPP-033](../opportunities/OPP-033-wiki-compounding-karpathy-alignment.md).
- **Discussion:** [the-wiki-question.md](../the-wiki-question.md).

## Acceptance

- After fix, a test or manual check: expansion run with a **distinctive** `me.md` line produces wiki pages that **reflect that line** without requiring a mail search hit for the same wording.
