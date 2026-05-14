# Agent tool design philosophy

How we design tools and prompts so the assistant reasons well without over-prescription.

---

## Core insight

Coding agents (Claude, Codex, etc.) handle enormous codebases effectively **not** because they have step-by-step instructions for every scenario, but because they have **clear tools**, **good context**, and **freedom to reason**. The same principle applies to Braintunnel's assistant: give it smart tools and let it think, rather than scripting every decision path.

## Two layers of guidance

| Layer | Owns | Does NOT own |
|-------|------|--------------|
| **Tools** | Output quality, actionable hints, self-description | Sequencing, when to call other tools |
| **System prompt** | General strategy, principles, tool vocabulary | Case-specific routing ("if X, call Y") |

### Tools: smart output, not dumb pipes

A tool should return **actionable information** based on what it learned while building its response. When results are weak, sparse, or ambiguous, the tool should say so — and suggest alternatives **in its output**, not by calling other tools.

**Examples of tool-side hints:**

- `search_index` returns 0–2 results for a person-name query → hint: `"Sparse results for a person-name query. For identity/company resolution, try find_person."`
- `search_index` coerces Gmail-style `from:` out of the regex → hint explaining what happened and how to do it right next time (already implemented in `searchIndexCoerce.ts`).
- `calendar` returns a wide date range with adaptive resolution → hint: `"[resolution: landmarks — recurring events omitted; narrow the window for full detail]"` (already implemented).
- A tool fails due to missing config → hint: `"Google Drive source not configured. Use manage_sources op=add kind=googleDrive to connect."`

The model reads hints and decides what to do. The tool doesn't decide for it.

### System prompt: principles, not playbooks

The system prompt should provide:

1. **Orientation** — what tools exist, what they're good for, how they relate.
2. **General principles** — "if you didn't find it, try again differently," "newest source wins," "read the date."
3. **Style and tone** — how to write wiki pages, how to cite sources, when to call `speak`.

The system prompt should **not** provide:

- Case-specific routing: "when the user asks about introductions, call `find_person` first."
- Multi-step playbooks: "Step 1: search wiki. Step 2: if no results, search mail. Step 3: …"
- Overfitted rules derived from single failure cases.

**Why:** Playbooks add cognitive load. Smaller models follow them rigidly or drop steps; larger models reason better without them. Adding rules for each observed failure creates a prompt that's long, brittle, and hard to maintain.

## When to add guidance vs. fix the tool

| Symptom | Likely fix |
|---------|------------|
| Model doesn't know a tool exists or what it's for | Improve the tool **description** |
| Model uses tool correctly but output doesn't help it decide next steps | Add **hints to tool output** |
| Model ignores hints and makes bad decisions | Try a **stronger model tier**, or accept the limit |
| Model follows a bad pattern repeatedly across many tasks | **Maybe** a prompt principle — but keep it general |

**Do not** add prompt rules for single failure cases. If one user's "introduced me to" question failed, the fix is not a rule about introduction questions — it's better tool output that helps the model pivot when search is weak.

## Tool description quality

Tool descriptions should:

1. **State what the tool is best at** — not just what it does mechanically.
2. **Clarify when to use it vs. alternatives** — especially for tools with overlapping scope.
3. **Warn about common mistakes** — but briefly, not a wall of text.

**Example (current `find_person`):**
> Find information about a person by searching email contacts (ripmail who) and wiki notes.

**Better:**
> Resolve a person's identity, email, company, and relationship context from email correspondence and wiki notes. Useful when you have a name but need the company or domain, or when text search returns ambiguous results. For top contacts by frequency, pass an empty query.

The improved version tells the model **when** the tool is valuable, not just what it does.

## Hints infrastructure

Tool output hints use the `hints` array in JSON responses (see `mergeSearchIndexStdoutHints` in `searchIndexCoerce.ts`). The model sees hints inline with results:

```json
{
  "results": [...],
  "totalMatched": 1,
  "hints": [
    "Sparse results for a person-name query. For identity/company resolution, try find_person."
  ]
}
```

Hints should be:
- **Actionable** — name a concrete next step or tool.
- **Conditional** — only appear when relevant (sparse results, coercion happened, config missing).
- **Brief** — one sentence, not a paragraph.

## Model tier and prompt density

Smaller models (mini tiers) struggle with:
- Long prompts with many rules
- Multi-step instructions they must remember across turns
- Subtle hints they should weigh against other evidence

Larger models reason better with:
- Fewer rules, more freedom
- Rich context they can synthesize
- Hints they can accept or reject based on the situation

**Implication:** If a task requires nuanced reasoning (like "should I pivot from search to contacts?"), consider whether it belongs on a stronger model tier — not whether to add more prompt rules that smaller models also won't follow well.

## Summary

1. **Tools own their output.** When results are weak, say so and suggest alternatives.
2. **System prompt owns principles.** Keep them general; avoid case-specific playbooks.
3. **Better descriptions > more instructions.** Help the model understand when to use each tool.
4. **Don't overfit to failures.** One bad outcome doesn't justify a new rule; it might justify a better hint.
5. **Trust the model — or pick a better one.** If reasoning is poor despite good tools and hints, the answer is model capability, not more rules.

---

## Related

- [pi-agent-stack.md](./pi-agent-stack.md) — pi-agent-core, tool definitions, metering
- [agent-chat.md](./agent-chat.md) — chat persistence, SSE, tools overview
- [chat-suggestions.md](./chat-suggestions.md) — `suggest_reply_options` and repair
- [BUG-056](../bugs/BUG-056-agent-late-contact-resolution-introduced-me-queries.md) — case study: search-first anchoring, hints as fix direction
