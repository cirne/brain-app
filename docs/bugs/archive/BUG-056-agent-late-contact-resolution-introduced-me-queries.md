# BUG-056 — Agent: "who introduced me to …" stalls on broad mail search instead of pivoting to contacts

**Status:** **Archived (2026-05-15).** Structured **`search_index`** zero-hit + high-recall metadata shipped (`recallSummary`, `suggestedNarrowings`, etc.); **`find_person`** tool description strengthened for identity vs noisy search; **`enron-026-intro-km-world-markets-vague`** regression checks grounded answers without requiring **`find_person`**. First-hit anchoring when snippets mislead remains a general modeling concern—not tracked as this backlog item.

**Related feedback:** #18 (2026-05-14)

---

## What's happening

For relational mail questions ("what company did [person] introduce me to that …?"), the assistant:

- Exhausts **`search_index`** with ever-broader body/subject terms and **anchors on the first plausible hit** even when clues are thin.
- Reaches for web search **before** exhausting **mailbox-native identity signals** (`find_person`, known correspondents, thread participants).
- Only resolves the answer after the user narrows with a known contact/email; **`find_person` then surfaced the domain and company** immediately.

Concrete example from feedback: clues (person names, geography, topical keywords) matched an unrelated vendor thread early; iterative search never converged until `find_person` on a correspondent email revealed the intended company.

## Design direction — tool hints, not more prescriptions

See **[agent-tool-design-philosophy.md](../../architecture/agent-tool-design-philosophy.md)** for principles. The fix should **not** add case-specific rules ("for introduced-me questions, call find_person first"). Instead:

1. **Tool output hints.** When `search_index` returns sparse or ambiguous results for a person-name-shaped query:
   - Inject a hint into the JSON `hints` array (same infrastructure as `searchIndexCoerce.ts` recency hints).
   - Example: `"Sparse results for a person-name query. For identity/company resolution, try find_person with a name or email."`
   - The model reads the hint and decides whether to pivot — no hardcoded routing.

2. **Better tool descriptions.** The `find_person` description says "Find information about a person by searching email contacts and wiki notes" — which undersells it. Consider:
   - "Resolve a person's identity, email, company, and relationship context from email correspondence (ripmail `who`) and wiki notes. Useful when you have a name but need the company or domain, or when text search returns ambiguous/sparse results."

3. **System prompt stays generalized.** Principle #1 ("If you didn't find it, try again differently") already covers "try a different approach." It does **not** need a carve-out for "introduced me" queries. If the model ignores hints, that's a model capability issue — solved by using a stronger model, not by adding more instructions that smaller models also won't follow.

## Root cause framing

- **Tool output wasn't actionable.** `search_index` returned results without signaling "these are sparse/ambiguous for what looks like a person question — you might want contact tools."
- **`find_person` didn't advertise its strength.** The description is factual but doesn't position the tool as the go-to for identity resolution when search is weak.
- **First-hit anchoring.** The model found *something* plausible and committed; this is a reasoning/calibration issue, not a routing issue. Better hints help; more rules don't.

## What NOT to do

- **Don't add prompt rules like** "when the user asks who introduced them to someone, use find_person before search_index." This overfits to one failure pattern and adds cognitive load that smaller models already struggle with.
- **Don't make tools call other tools.** Tools return data and hints; the model decides sequencing.
- **Don't assume the answer is more instructions.** The system prompt is already dense. If the model isn't reasoning well, consider whether it's the right model tier for the task.

## Implementation sketch

1. **`search_index` structured recall hints (shipped):**
   - **Zero hits (`totalMatched === 0`):** **`effectiveSearch`**, **`constraintsPresent`**, **`suggestedRelaxations`** (`case_insensitive`, `remove_after`, `remove_before`). See [`src/server/ripmail/searchZeroHitGuidance.ts`](../../../src/server/ripmail/searchZeroHitGuidance.ts). Pagination-only empty pages (`totalMatched > 0`) omit zero-hit fields.
   - **Broad / high-recall pools (`totalMatched > limit` or `totalMatched` ≥ 50):** **`recallSummary`** (counts, stable **`reasons`**: `high_recall_total_exceeds_page`, `high_recall_large_pool`) and **`suggestedNarrowings`** (`add_after_date`, …, `tighten_body_regex` for pattern searches). See [`src/server/ripmail/searchBroadHitGuidance.ts`](../../../src/server/ripmail/searchBroadHitGuidance.ts).
   - Wired from [`src/server/ripmail/search.ts`](../../../src/server/ripmail/search.ts). Tests: [`src/server/ripmail/ripmail.test.ts`](../../../src/server/ripmail/ripmail.test.ts).

2. **Sparse / ambiguous nonempty recall (follow-up outside this ticket):** **`recallSummary`** / **`suggestedNarrowings`** narrow pools without English heuristics; **first-hit anchoring** with misleading snippets may still warrant ranking or better snippets separately.

3. **`find_person` description:** **Shipped** — identity-first positioning in **`ripmailAgentTools.ts`** (see design direction above).

4. **No system prompt carve-outs** unless removing over-specific rules.

## Regression eval

- **`enron-026-intro-km-world-markets-vague`** in [`eval/tasks/enron-v1.jsonl`](../../../eval/tasks/enron-v1.jsonl): expects **`search_index`/`read_mail_message`**, grounded **Robert Johnston** + **World Markets Online** / **World Telecoms Online**, plus **`llmJudge`** (does **not** require **`find_person`**). Targets high-recall narrative from indexed mail; **not** zero-hit recovery.

## Related

- **[agent-tool-design-philosophy.md](../../architecture/agent-tool-design-philosophy.md)** — principles guiding this direction
- **[BUG-019 archived](BUG-019-mail-visible-in-client-but-missing-from-search.md)** — index gaps that compound search-only strategies
- **[BUG-028 archived](BUG-028-agent-email-draft-wrong-recipient-and-signature.md)** — separate (compose fidelity), but same theme: prefer authoritative identity over inference
