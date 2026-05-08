# OPP-099: Brain-to-brain admin / Hub UI (grants, policy, audit)

**Status:** Proposed — **Phase 0 backend + `ask_brain` shipped**; Settings surface is minimal viable.  
**Related:** [IDEA brain-query delegation](../ideas/IDEA-brain-query-delegation.md) · [architecture: brain-query-delegation](../architecture/brain-query-delegation.md) · **[architecture: brain-to-brain access policy](../architecture/brain-to-brain-access-policy.md)** (**Spike 1** Hub/B2B UI here first; fragments / layer 2 = **Spikes 3–4** in that doc) · [wiki-sharing.md](../architecture/wiki-sharing.md) (parallel “share directories” system)

---

## Why this exists

Cross-tenant **brain query** is a **trust surface**: explicit **grants**, **editable privacy policy per connection**, and an **audit log** (draft vs filtered answer for the owner; final answer for the asker). The **server path is in place** (`brain_query_*` tables, `/api/brain-query`, `BrainQuerySettingsSection.svelte`), but the **in-app experience is skeletal**.

Users who grant or receive access need to **understand what they are allowing**, **revoke quickly**, **scan history**, and **recover from mistakes**—without reading architecture docs. That is normal Hub / Settings polish, but it is **blocking** if the product thesis is “make B2B query the primary collaboration primitive.”

---

## Strategic context (wiki sharing vs B2B)

**Directory/wiki sharing** (projection, invites, shared subtrees) solves “see the same files.” **Brain query** solves “ask a question; get a filtered synthesis.” They overlap in intent (collaboration across tenants) but not in implementation cost.

**Hypothesis:** For many workflows, **query + policy + log** is enough and **simpler to secure and explain**. Keeping **both** may not be worth the added complexity. This OPP assumes we **invest in B2B admin UX first**; a separate product decision may **narrow, freeze, or retire** aggressive wiki-sharing expansion in favor of that clarity.

### Sequencing with policy spikes

Work under this OPP tracks **Spike 1 — Hub / B2B UI** in [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md#spike-1-b2b-ui-opp-099): **grants, audit, trust copy, and one plaintext `privacy_policy` textarea per grant** (plus optional template strings, filter preview, and **human-confirmed** LLM policy suggestions). **Spike 2** (plaintext++: history, curated preset **strings**, optional capability toggles) may overlap this OPP or follow immediately after.

**Deferred here:** **Spike 3** (fragment library / structured presets) and **Spike 4** (hard wiki/mail predicates)—revisit after Hub affordances and Spike 2 are in good shape.

---

## Current code pointers

- **UI:** `[BrainQuerySettingsSection.svelte](../../src/client/components/BrainQuerySettingsSection.svelte)` (+ `[BrainQuerySettingsSection.test.ts](../../src/client/components/BrainQuerySettingsSection.test.ts)`)
- **API:** `[brainQuery.ts](../../src/server/routes/brainQuery.ts)` — grants CRUD, `POST /` query, `GET /log?role=`
- **Chat `@` today (wiki only):** `[AgentInput.svelte](../../src/client/components/AgentInput.svelte)` — `@` opens a single list of **wiki paths**, inserts `@{path}`, renders options with `[WikiFileName.svelte](../../src/client/components/WikiFileName.svelte)`. **User bubbles** are plain text in `[ChatMessageRow.svelte](../../src/client/components/agent-conversation/ChatMessageRow.svelte)` (`msg.content`), so new mention types need a **render pass** there (or a small `UserMessageContent` helper), not only composer changes.
- **Handle suggest API (reuse):** `GET /api/account/workspace-handles?q=…` — same source as `[WikiShareDialog.svelte](../../src/client/components/WikiShareDialog.svelte)` grantee picker.

---

## Chat composer: `@` mentions for **people** (handles) vs **wiki documents**

Brain-to-brain flows (“ask `@donna` …”) should feel as natural as wiki `@` mentions. Today the composer only knows **files**; we need **workspace handles** in the same `@` affordance **without** looking like a document reference.

### Requirements

1. **Autocomplete** — When the user types `@`, offer **both** (or a clear mode):
  - **Wiki documents** — current behavior: paths, `[WikiFileName](../../src/client/components/WikiFileName.svelte)` in the dropdown.
  - **People / handles** — results from `**/api/account/workspace-handles`**, show `@handle` + display name (mirror share-dialog rows).
2. **Disambiguation** — Pick a grammar that models can learn and that parses reliably, e.g.:
  - **Sectioned dropdown** (“Documents” vs “People”), or
  - Heuristic (path-like tokens with `/` vs bare handle), or
  - Explicit prefix only if we must (`@:` person vs `@` doc — last resort; hurts UX).
   Document the chosen rule in this OPP when implemented.
3. **Rendering — must differ from wiki mentions** — In the **transcript** (and ideally inline while typing if we ever rich-compose user text):
  - **Wiki:** keep **file-style** presentation (path segments, doc semantics, open-wiki affordance later).
  - **Person / handle:** distinct **chip** or badge (e.g. different background, “person” affordance — icon or label pattern — **not** `WikiFileName` styling so users never confuse “I tagged a file” with “I tagged a collaborator’s brain”).
4. **Accessibility** — Listbox sections for mixed results; screen reader labels that say “person” vs “wiki document”.

### Engineering sketch

- Extend `AgentInput` mention state: fetch handle suggestions (debounced) alongside `filteredMentions()` from `wikiFiles`.
- Optionally normalize inserted tokens so the server/agent sees unambiguous `targetHandle` for `ask_brain` (may already parse `@handle` in NL).
- Parse outgoing **stored user `content`** for display-only chips in `ChatMessageRow` for `role === 'user'` — same token grammar as composer; unit tests for parser + renderer.

---

## UX goals (non-exhaustive)

1. **Grants**
  - Clear “who can ask my brain” vs “whose brain I can ask” (owner-centric vs asker-centric framing).
  - **Grant creation** flow aligned with wiki-share handle picker patterns where it helps, but **not** conflated with “share files.”
  - **Revoke** obvious and immediate; copy explains what stops working.
2. **Policy editor**
  - **Spike 1 ([access-policy spikes](../architecture/brain-to-brain-access-policy.md#implementation-spikes-ui-first-then-policy-depth)):** per-connection **privacy policy** textarea with **reset to default** and short **inline guidance** (what the filter pass sees). Optional: **starter templates** (load curated strings only), read-only **filter preview**, **human-confirmed** LLM suggestions on save — still **one stored blob** per grant.
  - **Later (Spikes 3–4 in that doc):** preset/fragment UI, **effective policy preview** from structured stacks, **layer-2** hard predicates — **out of scope** for closing this OPP unless explicitly pulled in.
3. **Audit log**
  - **Inbound (owner):** question, status, timestamps, **draft** vs **final**, filter notes / redaction hints when present.
  - **Outbound (asker):** question + **final** only; statuses like `denied_no_grant` / `filter_blocked` readable without jargon.
  - **Empty states** and pagination or cap messaging if logs grow.
4. **Platform**
  - **Mobile** Sharing layout (may compose with [OPP-092](OPP-092-mobile-navigation-ia-rethink.md)).
  - **Discoverability:** link from onboarding or Sharing overview (“Brain queries”) so users find the feature after Phase 0 ships.
5. **Trust copy**
  - Short, accurate statements: **no raw mail leaves** the owner’s tenant; **LLM filter is not cryptographic**; **policy is instructions** to the filter model.
6. `**@` mentions in chat (handles vs wiki)** — See **Chat composer: `@` mentions for people vs wiki documents** in this doc: combined or sectioned picker, unambiguous grammar, **visually distinct transcript rendering** for people vs documents.

---

## Engineering notes

- Reuse existing API contracts where possible; prefer **additive** query params or response fields over breaking changes.
- Component tests for new flows per [component-testing.md](../component-testing.md).
- If UX research suggests **split panels** (grants vs log), keep routes **simple** (`/hub` sections) unless deep-linking is required.

---

## Exit criteria

- A new user can **grant**, **edit policy**, **revoke**, and **read logs** on **desktop and mobile** without confusion, in line with the goals above.
- Copy and layout reviewed for **honest security framing** (filter limits, no over-promise).
- Hub policy UX **aligns with [implementation spikes](../architecture/brain-to-brain-access-policy.md#implementation-spikes-ui-first-then-policy-depth)** — **Spike 1** textarea + optional Spike-1 helpers; **Spikes 3–4** (fragments, hard predicates) remain future work unless scope changes.
- **Chat:** Users can `@`-mention **confirmed workspace handles** from the composer; **person mentions render differently** from **wiki document** mentions in the transcript (and documented grammar).
- Optional follow-on (separate OPP): notifications, export, cross-instance—**out of scope** here unless trivial.