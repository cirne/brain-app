# BUG-056 — Agent: "who introduced me to …" stalls on broad mail search instead of pivoting to contacts

**Status:** Open  
**Priority:** Medium  

**Related feedback:** #18 (2026-05-14)

---

## What's happening

For relational mail questions ("what company did [person] introduce me to that …?"), the assistant:

- Exhausts **`search_index`** with ever-broader body/subject terms and **anchors on the first plausible hit** even when clues are thin.
- Reaches for web search **before** exhausting **mailbox-native identity signals** (`find_person`, known correspondents, thread participants).
- Only resolves the answer after the user narrows with a known contact/email; **`find_person` then surfaced the domain and company** immediately.

Concrete example from feedback: clues (person names, geography, topical keywords) matched an unrelated vendor thread early; iterative search never converged until `find_person` on a correspondent email revealed the intended company.

## Design direction — tool hints, not more prescriptions

See **[agent-tool-design-philosophy.md](../architecture/agent-tool-design-philosophy.md)** for principles. The fix should **not** add case-specific rules ("for introduced-me questions, call find_person first"). Instead:

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

1. **`searchIndexCoerce.ts` or `ripmailAgentTools.ts`:** After search executes, if:
   - Result count is low (≤2) or totalMatched is 0
   - AND the query or `from` field looks like a person name (reuse `looksLikePersonNameOnly`)
   - → Merge a hint: `"Sparse results for a person-name query. For identity/company resolution, try find_person."`

2. **`find_person` description:** Update to emphasize identity/company resolution, not just "search contacts."

3. **No system prompt changes** unless removing over-specific rules that already exist.

## Related

- **[agent-tool-design-philosophy.md](../architecture/agent-tool-design-philosophy.md)** — principles guiding this direction
- **[BUG-019](BUG-019-mail-visible-in-client-but-missing-from-search.md)** — index gaps that compound search-only strategies
- **[BUG-028](BUG-028-agent-email-draft-wrong-recipient-and-signature.md)** — separate (compose fidelity), but same theme: prefer authoritative identity over inference
