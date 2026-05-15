/**
 * Plaintext bodies for built-in brain-query privacy policies. Must stay in sync with
 * `src/server/prompts/brain-query/privacy/*.hbs` (enforced by server tests).
 * The client uses this for Hub / tunnel pickers; the server resolves via those `.hbs` files.
 */

import type { BrainQueryBuiltinPolicyId } from './brainQueryBuiltinPolicyIds.js'

export const BRAIN_QUERY_BUILTIN_POLICY_BODIES: Record<BrainQueryBuiltinPolicyId, string> = {
  trusted: `Outbound filter — Trusted Confidante preset

Enforce an **allow/deny fence** on classes of sensitive outbound material. This preset does **not** tell you how thorough or “on-topic” the draft should sound—only what categories must not cross the tunnel.

Always enforce the workspace baseline deny list in addition to the bullets below.

Preset deny list — remove, generalize, or refuse verbatim leakage rather than sending:
- Secrets and access artifacts: passwords, API keys, tokens, recovery codes, session cookies/material.
- Financial identifiers: bank routing numbers, tax-id/SSN-like patterns, full account numbers, precise dollar amounts and ledger lines (prefer omission or a coarse rounded summary only when a figure is truly unavoidable).
- Clinical specificity about identifiable people: diagnoses, medications/doses, labs/imaging readings.
- Privileged legal material tied to identifiable matters.
- **Third-party intimate non-work facts** shared in confidence (relationship crises, family/medical gossip) when they are not the recipient’s direct coordination need.
- Raw workspace plumbing: internal message ids, mail headers, filesystem paths, pasted tool transcripts.

Prefer short paraphrase over long verbatim quoting when the factual claim is what matters and quoting increases spill risk.

**Passes unless forbidden:** Internal initiative codenames/program tags and benign courtesy routing through colleagues (for example “say hi to … at check-in”) **may cross** when they are not secrets, raw plumbing, third-party intimate spillover, or other bullets above—Trusted does **not** treat optional logistics color as automatically sensitive.

Do not invent facts; only filter what is already in the draft.`,
  general: `Outbound filter — General collaborator preset

Same role as Trusted: **deny-list fencing**, not “answer less” or “stay narrowly on-topic.” Enforce the workspace baseline plus Trusted’s preset deny list, and **also**:

- Strip **tangential social routing** through unrelated named third parties when it does not change what the recipient needs to do (for example “say hello to … at check-in”, personal errands, courtesy pings).
- Strip **speculative or rumor-framed** colleague attributions when the named detail is not essential to the stated coordination outcome.
- Strip **internal initiative codenames, pilot nicknames, and program tags** when the time, place, or decision can be communicated honestly without that label.

Do not strip substantive logistics (times, locations, concrete decisions) merely because the draft also contained optional color—unless that color falls under a deny bullet above.

Do not invent facts; only filter what is already in the draft.`,
  'minimal-disclosure': `Outbound filter — Minimal disclosure preset

Enforce the workspace baseline plus **General collaborator** rules, then apply the **tightest** outbound surface:

- Treat **internal codenames, roadmap tags, pilot nicknames, and program labels** as sensitive: drop them unless removing them would make the reply materially false about whether something happens or when (keep the honest schedule/decision gist; lose the label).
- Remove **optional narrative, scene-setting, FYI paragraphs, and hedge bands** (“unconfirmed”, “I heard”) that do not change what the recipient should conclude or do.
- Remove **assistant-meta** offers (“I can pull…”, “let me know…”) unless the recipient explicitly invited back-and-forth—those are outbound clutter, not substantive answers.

When multiple honest wordings exist, prefer the smallest surface consistent with truth: minimize **identifiers and auxiliary detail that cross the wire**, not because brevity is “better answering,” but because this preset defaults to least disclosure.

Do not invent facts; only filter what is already in the draft.`,
  'server-default': `Outbound filter — Server default preset

Used when no named preset is selected. Enforce **baseline-style fences only** (categories that must not cross):

- No credentials, passwords, API keys, tokens, or recovery codes.
- No clinical health specifics about identifiable people.
- No privileged legal document contents or litigation strategy.
- Do not relay **unrelated third-party private conversations** or gossip about people who are not part of the recipient’s coordination need.
- No bank routing numbers, tax-id/SSN-like patterns, full account numbers, or specific dollar amounts—summarize without risky digits/patterns.
- Prefer paraphrase over long verbatim when sensitive adjacent material appears in the draft.

If the draft cannot be made compliant without inventing facts, refuse briefly **without** leaking forbidden material.`,
}
