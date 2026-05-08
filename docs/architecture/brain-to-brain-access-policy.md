# Brain-to-brain access policy model

**Status:** Draft — **design synthesis** for collaboration trust surfaces (brain-query, future bilateral flows, wiki shares). **Phase 0 shipped behavior** remains what [brain-query-delegation.md](./brain-query-delegation.md) describes (grant row + single privacy-policy text + two-pass LLM); this doc is the **target architecture** for evolving policy without turning admin into OAuth-scale complexity.

**Near-term product focus:** **[OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** (B2B / Hub UI — grants, policy editor, audit log, trust copy). **Ship Hub clarity first**; treat **richer policy mechanics** (fragments, hard predicates, cross-surface unification) as **later spikes** (see [Implementation spikes](#implementation-spikes-ui-first-then-policy-depth)).

**See also:** [IDEA: Brain-query delegation](../ideas/IDEA-brain-query-delegation.md) · [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) · [wiki-sharing.md](./wiki-sharing.md) · [integrations.md](./integrations.md) (Ripmail boundary) · **[OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** (Hub / Settings UX)

---

## Goals

- **Default deny** at the relationship boundary: no grant → no cross-brain operations.
- **Powerful but simple:** numbered presets for typical users; libraries of reusable pieces for advanced users—**not** an unconstrained dependency graph of policies.
- **Defense in depth:** combine **machine-enforced** rules (tools, paths, mail predicates) with **soft instructions** (LLM-facing fragments). Neither layer replaces the other.
- **Honest security UX:** soft rules are **instructions**, not cryptographic guarantees; copy and Hub surfaces should say so (aligned with [OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)).
- **Reuse Ripmail semantics** where mail is constrained: same **search-shaped** predicates / evaluator as inbox rules and `ripmail search` (see [Ripmail INBOX-CUSTOMIZATION](../../ripmail/skills/ripmail/references/INBOX-CUSTOMIZATION.md), `[SearchOptions](../../ripmail/src/search/types.rs)`, `[OPP-038` archived](../ripmail/docs/opportunities/archive/OPP-038-inbox-rules-as-search-language.md)).

---

## Three layers (overview)


| Layer                            | Role                                                                                                                                                             | Enforcement                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Capabilities**             | Which **operations** may run at all for this grant (coarse gates).                                                                                               | Server / tool registration: allowlisted tools, APIs, “may invoke brain-query,” etc.                                                                                                                                                                |
| **2 — Hard resource predicates** | **What data** may enter research or cross the boundary: wiki path allow/deny, mail filters (sender, subject/body pattern, date window, category, mailbox id, …). | Deterministic checks on **every** path: search **and** fetch-by-id / thread expansion. Prefer intersecting caller intent with policy (`user_query ∧ allow ∧ ¬deny`). Optionally push merged predicates into Ripmail so excluded rows never return. |
| **3 — Soft policy fragments**    | **How to behave** inside the allowed envelope: tone, summarization, topic-specific bullets.                                                                      | Prompt assembly for research and/or privacy-filter passes; **best-effort** LLM adherence.                                                                                                                                                          |


Layers stack: **(1)** gates whether tools run; **(2)** constrains what raw content tools may return; **(3)** guides synthesis and outbound filtering.

---

## Soft fragments: polarity and facets

### Polarity

Fragments are **ALLOW** or **DISALLOW**:

- **DISALLOW** — “Do not reveal X,” “no dollar amounts,” “no health detail.”
- **ALLOW** — “May discuss these named projects,” “may summarize travel logistics,” exceptions/nuance within an envelope.

Polarity supports a **bubble / chip** mental model (drag to reorder, toggle type) and clear conflict UX.

### Facets

A **facet** is a **named dimension** so rules know **what they regulate** and **which rules compete**.

Examples (illustrative ids):


| Facet            | Examples                                                 |
| ---------------- | -------------------------------------------------------- |
| `health`         | Medical / wellness detail                                |
| `finance`        | Money, accounts, investments                             |
| `calendar`       | Scheduling / event detail vs free-busy                   |
| `projects`       | Named initiatives, codenames                             |
| `wiki_scope`     | Path prefixes / namespaces                               |
| `mail_predicate` | (Often better as **hard** layer; facet ties UI grouping) |
| `third_parties`  | People not involved in the query                         |
| `temporal`       | Time windows (prefer structured fields when possible)    |


Fragments **without** a facet behave as **global tone / catch-all** instructions (lowest structural precedence unless product defines otherwise).

### Precedence (recommended defaults)

Rules below are **per grant / preset** unless superseded by explicit product decisions:

1. **Hard layer beats everything** — if mail or wiki path is excluded, it never reaches the model (ideal) or the pipeline rejects the operation.
2. **Within soft fragments, by facet:** **DISALLOW beats ALLOW** when the model/policy engine cannot classify cleanly (“when in doubt, don’t share”).
3. **Specificity:** within ALLOW on the same facet, **narrow** beats **broad** (named projects beat generic “work updates”) when the implementation can represent specificity (structured lists > prose alone).

**Ordering-only “later wins”** is acceptable for **tone** fragments but risky for safety unless DISALLOW fragments are treated as **hard for that facet** (short-circuit).

### Structured payloads inside bubbles

Where users want real logic—**calendar Mon–Fri**, **wiki subtree**, **project ids**, **sender denylist**—store **small structured fields** on the fragment or on the **hard predicate** row, and use prose as explanation or extra steering. That preserves Boolean/time semantics and keeps Ripmail/wiki enforcement aligned with what the UI shows.

---

## Composition: library, presets, grants

- **Fragment library** — reusable ALLOW/DISALLOW entries (with optional facet + structured payload); curated defaults plus user-authored bubbles (“Phoenix rollout,” “ARTEMIS”).
- **Preset** — ordered list of fragment ids + a **capability bundle** (layer 1). Presets are **templates** (“Colleague,” “Inner circle,” “Read-only Q&A”). Prefer **composition via fragment lists** over deep **preset extends preset** inheritance; at most **one** “extends Standard” level if needed for UX, with a defined merge order (append fragments; DISALLOW facets still win per precedence above).
- **Grant** — `(owner, peer)` → **one chosen preset** + optional **small override** (extra paragraph or delta bullets). Assignment should not require re-authoring the whole policy each time.

**Effective policy preview** (Hub): render human-readable summary from `{ capabilities + fragment titles + overrides }` so users never debug raw inheritance.

### AI-assisted authoring

Agents may **draft or review** stacks (suggest fragments, detect contradictions). Persist **structured output** (facet, polarity, ids, optional payload) plus human confirmation—not only prose—so the UI stays trustworthy.

---

## Hard predicates: wiki and mail

### Wiki

- **Path allowlists / denylists** — prefix-based alignment with today’s directory-share mental model ([wiki-sharing.md](./wiki-sharing.md)); enforcement on **read APIs** and agent tools before bytes cross contexts.
- Cross-brain **brain-query** research should intersect allowed wiki roots with any grant-specific rules **before** file reads (future; Phase 0 does not split wiki subtree per grant in code).

### Mail

- Express constraints with the **same predicate vocabulary** as Ripmail search / inbox rules where possible (`from:`, `to:`, `subject:`, body pattern, dates, categories, mailbox ids—see Ripmail `SearchOptions` and query parse pipeline).
- Apply on **search** and on **read-by-id / thread expansion** (search filtering alone is insufficient).
- **Integration patterns:** (a) Brain merges policy into each Ripmail invocation; (b) materialized policy file under tenant `RIPMAIL_HOME`; (c) server-side only intersection before returning rows. Choose per performance and deployment; **one evaluator** avoids semantic drift.

### Delegation / risky flows

For **cross-brain** grants, prefer **allowlist-first** mail/wiki visibility (“only these subtrees / only mail matching …”) and use DISALLOW predicates as **safety nets** or exceptions—not an open vault plus long denylists alone.

---

## Relation to existing permission vocabulary

[IDEA-wiki-sharing-collaborators](../ideas/IDEA-wiki-sharing-collaborators.md) lists capabilities such as `wiki:read`, `calendar:availability`, `query:general`. Treat those as **layer 1 examples** / user-facing labels—not an exhaustive schema. The **canonical decomposition** for implementation is this doc’s **three layers**; vocabulary rows map into **capability bundles** plus optional **hard** and **soft** attachments.

---

## Phasing (summary)


| Phase                 | Behavior                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0 (shipped)** | `brain_query_grants` with **single textarea** `privacy_policy` (default seeded text); research pass + privacy-filter pass; see [brain-query-delegation.md](./brain-query-delegation.md). |
| **Next (policy depth)** | After Hub work: preset/fragment wiring, then **layer 2** (wiki/mail predicates). See **spikes** below for a deliberate ramp.                                                                |

---

## Implementation spikes (UI first, then policy depth)

Spikes are **ordered by intended delivery**. The **first incremental work** after Phase 0 is **not** a richer policy engine—it is **usable admin and chat affordances** under **[OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)**. Policy stays **one plaintext blob per grant** until a later spike requires structure.

<a id="spike-0-baseline"></a>
### Spike 0 — Baseline (shipped)

- **Storage:** single `privacy_policy` text per grant; default seed ([brain-query-delegation.md](./brain-query-delegation.md)).
- **Enforcement:** research agent (owner tenant) → **privacy-filter pass** uses that blob only; no fragment IDs, no hard predicates in code.
- **Unification:** none—brain-query policy is **not** merged with wiki-share ACLs at evaluation time (mental-model copy in Hub may still distinguish “share files” vs “answer questions”).

<a id="spike-1-b2b-ui-opp-099"></a>
### Spike 1 — Hub / B2B UI (primary near-term focus → OPP-099)

**Goal:** Users can grant, edit policy, revoke, and read logs **without** reading architecture docs—**before** investing in sophisticated policy schemas.

Still **one text blob** per grant; backend filter behavior unchanged unless we add **advisory** helpers.

| In scope | Out of scope (defer) |
| -------- | -------------------- |
| Grants, revoke, inbound/outbound audit presentation, honest security copy | Fragment library, facet model, DB `preset_id` columns |
| Optional **starter templates** that only **load strings** into the textarea (e.g. “Colleague,” “Inner circle”) — no new evaluator | Compiling preset → structured rules server-side |
| Optional **read-only “what the filter sees”** preview (assembled prompt prefix + policy text) | Layer-2 wiki path / mail predicate enforcement |
| Optional **LLM-assisted policy editing** on save: suggest clearer bullets, flag vagueness — **human confirms**; stored value remains user-approved plaintext (no silent rewrite of the binding policy) | AI-authored policy persisted without review |

<a id="spike-2-plaintext-plus"></a>
### Spike 2 — Plaintext++ (policy ergonomics, still soft-first)

**Goal:** Better **operability and audit** without the full three-layer product.

- **Policy change history** (append-only log or versioning: who/when; one active `privacy_policy`).
- **Named starter presets in product** = **curated default strings** + label in UI (still one stored blob; optional `preset_label` for support/debug).
- **Layer 1 lite (optional):** coarse **capability toggles** (e.g. “mail may inform answers” vs “wiki/calendar only”) implemented as **server-side tool allowlists** for brain-query research—not as prose the filter must interpret.

**Unification:** still **defer** merging wiki-share rules into brain-query enforcement until both need the same path semantics.

<a id="spike-3-structured-policy"></a>
### Spike 3 — Structured policy (target architecture, this doc)

- **Fragment library** + preset composition (**compile to one prompt string** for filter/research); persist fragment ids + optional `compiled_policy` cache for debugging.
- **Effective policy preview** in Hub from `{capabilities + fragments + override}`.
- **AI-assisted authoring** outputs **structured** suggestions; user confirms before persistence (aligned with [AI-assisted authoring](#ai-assisted-authoring)).

<a id="spike-4-hard-predicates"></a>
### Spike 4 — Hard predicates (layer 2)

- Wiki path allow/deny per grant; Ripmail-aligned mail predicates on search **and** fetch-by-id / thread expansion; optional push into Ripmail subprocess—per [Hard predicates](#hard-predicates-wiki-and-mail).

---

## Legacy phasing table (reference)


| Phase        | Maps to spikes | Behavior |
| ------------ | -------------- | -------- |
| **Phase 0**  | Spike 0        | Shipped: textarea + two-pass LLM. |
| **Next**     | Spikes 1–2     | Hub (OPP-099); then plaintext++ and optional capability toggles. |
| **Later**    | Spikes 3–4     | Fragments/presets; full layer 2. |

---

## Non-goals (for this model)

- Replacing **tenant isolation** or session auth (see [SECURITY.md](../SECURITY.md)).
- Promising **cryptographic** or **perfect** outbound filtering—soft layer remains LLM-mediated.
- **OAuth-console-grade** capability negotiation for typical users; power features expose structure **progressively**.

---

## Implementation pointers (current code)

- Grants / policy text: `[brainGlobalDb.ts](../../src/server/lib/global/brainGlobalDb.ts)`, `[defaultPrivacyPolicy.ts](../../src/server/lib/brainQuery/defaultPrivacyPolicy.ts)`, `[runBrainQuery.ts](../../src/server/lib/brainQuery/runBrainQuery.ts)`.
- Hub UI backlog: [OPP-099](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md).

Future work should extend these **additively** (preset columns or JSON policy blob version field) per early-dev norms in [AGENTS.md](../../AGENTS.md).