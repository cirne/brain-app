# OPP-065 — Wiki eval: LLM-as-judge scoring

## Problem

The current wiki eval harness (`wiki-v1.jsonl`, `runWikiAgentEvalCase.ts`) can only assert:

- **Tool names** — did the agent call `search_index`, `write`, etc.?
- **Substring presence** — does a known string appear in search results or the final narration?

These are smoke tests. They prove the agent ran without crashing but say nothing about page *quality*. A page full of raw mail-volume stats ("243 sent, 227 received") passes every current assertion.

The core quality question — *would an assistant reading only this page be meaningfully better at helping the user without going back to email?* — cannot be checked with substring matching.

## Proposed solution

Add an `llmJudge` expect kind to `checkExpect` that sends the written content (or the agent's narration) plus a rubric to a cheap LLM and returns pass/fail with a reason.

### New expect node shape

```ts
{
  kind: 'llmJudge',
  question: string,           // rubric question, answered yes/no
  target: 'finalText' | 'toolTextConcat' | 'both',  // what to judge
  caseId?: string,            // for logging / tracing
}
```

Example usage in `wiki-v1.jsonl`:

```jsonc
{
  "kind": "llmJudge",
  "question": "Does the page for Richard Shapiro clearly state who led the U.S. Energy group after the November 2001 reorganization, without requiring the reader to know which email the fact came from?",
  "target": "finalText"
}
```

### Implementation sketch

1. `**checkExpect.ts**` — add `llmJudge` case; call a shared `llmJudgeCheck(question, content)` helper that returns `{ ok: boolean, reason: string }`.
2. `**llmJudgeCheck.ts**` — thin wrapper around the existing LLM provider abstraction; prompt: "Answer yes or no. Reason in one sentence. Question: {question}\n\nContent:\n{content}". Parse `yes` / `no` from the first word.
3. **Cost guard** — `llmJudge` nodes should default to a cheap/fast model (`gpt-4.1-mini` or equivalent). Add `model` override to the node shape for cases that need stronger judgment.
4. **Eval report** — surface `llmJudge` results with their reason string in the JSON report so failures explain themselves.

### Eval cases this unlocks


| What to check                                              | Why substring matching fails                    |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Page synthesizes conclusions, not just observations        | "California" appears in both good and bad pages |
| No raw mail-volume stats                                   | Hard to assert absence reliably                 |
| People page has assistant-facing notes (reply guidance)    | Content varies; hard to predict exact wording   |
| Topic page has "Why it matters here" equivalent            | Section title may vary                          |
| Enron's Dynegy deal purpose captured in one clear sentence | Need semantic match, not keyword match          |


## Related

- Current smoke tests: `eval/tasks/wiki-v1.jsonl` (`wiki-001` through `wiki-005`)
- Buildout quality prompt: `src/server/prompts/wiki-buildout/system.hbs`
- Harness: `src/server/evals/harness/runWikiAgentEvalCase.ts`, `checkExpect.ts`
- Related: [OPP-060](OPP-060-starter-wiki-templates-and-agent-authoring.md) (starter templates), [OPP-062](OPP-062-post-turn-wiki-touch-up-agent.md) (post-turn touch-up)

## Effort

Small-medium. `llmJudgeCheck` is ~30 lines. The main integration work is plumbing it through `checkExpect` and surfacing reasons in the report JSON. Existing eval infrastructure (harness, report format, `npm run eval:build`) is unchanged.