# BUG-058: Brain Query built-in privacy templates frame policy as relevance/detail, not as outbound filters

**Status:** Fixed (2026-05-15)  
**Scope:** Built-in policy prompt bodies under `src/server/prompts/brain-query/privacy/` (e.g. `trusted.hbs`, `server-default.hbs`, `minimal-disclosure.hbs`, `general.hbs`) and any UI copy that mirrors the same framing.

## Problem

The current built-in policies read as instructions about **how much detail to provide** or **how closely the answer should track the question**—i.e. **answer quality / relevance**. That is **not** the job of a privacy policy in this system.

Privacy policy here should define **what classes of information must always stay out of replies** (and related behavioral guardrails: confidentiality, discretion, least disclosure), regardless of whether the user’s question would “benefit” from richer context.

Conflating policy with *relevance* invites the model to think the grantee gets more or less *substance* based on preset name, instead of a clear **allow/deny fence** on sensitive material.

## Desired direction

Rewrite the built-in templates as **filter policies** (outbound rules), not “how thorough to be” policies:

- **Trusted advisor / confidante-style presets:** **permissive filter** — few categories ruled out; assume good faith and broader sharing where not explicitly blocked.
- **Minimal disclosure:** **restrictive filter** — strong discretion; default to withholding unless necessary; explicit stance on confidentiality, third parties, credentials, health/financial identifiers, workplace drama, etc., as appropriate to the product’s threat model.

Intermediate presets (general, server default) should sit between those poles as **clear filter sets**, not as “answer length” or “stick to the question” knobs.

## Acceptance notes

- New template text should be testable in principle (e.g. snapshot or harness that ensures presets still load; optional golden snippets if we add regression tests later).
- Product/UI labels should stay aligned with “what never crosses the wire,” not “how smart or detailed the reply is.”

## Validation

- **Regression — existing filter-path evals must stay green.** The B2B tunnel **privacy filter** (`filterB2BResponse`, prompt `b2b/filter.hbs`) is what applies grant policy text (including built-in preset bodies once resolved onto the grant). Before landing rewritten templates, confirm the current suites still pass end-to-end, including:
  - `npm run eval:b2b:filter` — filter-only JSONL (`eval/tasks/b2b-filter.jsonl`; scenarios are exercised **across built-in policies** today).
  - `npm run eval:b2b:e2e` — slim research + filter (`eval/tasks/b2b-e2e.jsonl`).
  - `npm run eval:b2b` — parallel bundle of B2B JSONL suites (see [eval/README.md](../../../eval/README.md)).
  - Any **Vitest** that pins filter behavior (e.g. `b2bAgent.test.ts` and related harness tests).
- **New coverage — intent of the filter policies.** Extend the filter eval corpus (and/or E2E cases if needed) with scenarios that **directly test outbound filter semantics**: e.g. the same draft should pass under a **trusted / permissive** preset but be redacted or refused under **minimal disclosure**; categories that must **always** be stripped regardless of question relevance; and at least one case per major preset that would **fail** if the template drifted back to “answer less / stay on topic” instead of “block these information classes.”

## Resolution

- Rewrote built-in privacy `.hbs` bodies and `server-default` as **outbound deny-list fences** (Trusted permissive; General mid; Minimal tight), synced `BRAIN_QUERY_BUILTIN_POLICY_BODIES` + picker hints.
- Updated `b2b/filter.hbs` so the wrapper model treats grant text as **what must not cross**, not answer thoroughness; explicit guidance for Trusted vs over-filtering.
- B2B filter JSONL: added `b2b-filter-preset-fence-codename-courtesy` (trusted retains optional color; general/minimal strip codename + courtesy tokens); full `npm run eval:b2b:filter` green.
- Hub: merging server `GET /api/brain-query/policies` with legacy `custom:*` rows from localStorage so empty server lists no longer hide client-only policies (`PolicyDetailPage.svelte`).

## Related

- [BUG-048](../BUG-048-brain-access-policy-bucket-mismatch-text-snapshots.md) — UI classification of policy text vs templates (separate from *semantics* of the template bodies).
