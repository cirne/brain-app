# Archived: OPP-099 — Brain-to-brain admin / Hub UI (grants, policy, audit)

**Status: Archived — epic closed (2026-05).** **Active pointer / shipped summary:** [architecture/brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure). **Stub:** [../OPP-099-brain-to-brain-admin-hub-ui.md](../OPP-099-brain-to-brain-admin-hub-ui.md)

**Related:** [IDEA brain-query delegation](../../ideas/IDEA-brain-query-delegation.md) · [architecture: brain-query-delegation](../../architecture/brain-query-delegation.md) · **[architecture: brain-to-brain access policy](../../architecture/brain-to-brain-access-policy.md)**

---

## Why this exists

Cross-tenant **brain query** is a **trust surface**: explicit **grants**, **editable privacy policy per connection**, and an **audit log** (draft vs filtered answer for the owner; final answer for the asker). The **server path is in place** (`brain_query_*` tables, `/api/brain-query`, `BrainQuerySettingsSection.svelte`), but the **in-app experience is skeletal**.

Users who grant or receive access need to **understand what they are allowing**, **revoke quickly**, **scan history**, and **recover from mistakes**—without reading architecture docs. That is normal Hub / Settings polish, but it is **blocking** if the product thesis is “make B2B query the primary collaboration primitive.”

---

## Follow-up: policy text copied on every grant (not required for OPP-099 closure)

**Today:** each `brain_query_grants` row stores the full `privacy_policy` **string** (denormalized); logical policy edits fan out to **O(n)** PATCHes. **Canonical write-up and next steps** live under **Denormalized `privacy_policy`** in [brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md) (Spike 2+ / future OPP).

---

## Strategic context (B2B)

Cross-tenant collaboration is centered on **brain query**: explicit **grants**, **policy per connection**, and an **audit log**—“ask a question; get a filtered synthesis” under rules the owner controls. This OPP assumes **B2B admin UX is the investment priority**; directory- and page-level wiki share flows are **not** part of the forward product surface.

### Sequencing with policy spikes

Work under this OPP tracked **Spike 1 — Hub / B2B UI** in [brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md#spike-1-b2b-ui-historical--opp-099): **grants, audit, trust copy, and one plaintext `privacy_policy` textarea per grant** (plus optional template strings, filter preview, and **human-confirmed** LLM policy suggestions). **Spike 2** (plaintext++: history, curated preset **strings**, optional capability toggles) may follow immediately after.

**Deferred here:** **Spike 3** (fragment library / structured presets) and **Spike 4** (hard wiki/mail predicates)—revisit after Hub affordances and Spike 2 are in good shape.

---

## Current code pointers

- **Hub Sharing surface:** `[HubSharingSection.svelte](../../../src/client/components/hub/HubSharingSection.svelte)` mounted from `[BrainHubPage.svelte](../../../src/client/components/BrainHubPage.svelte)` — **brain-query** grants and related UX are the focus; legacy wiki-share rows may still appear until that path is removed. Settings retains a **shortcut link** to this section.
- **Brain access UI:** `[BrainQuerySettingsSection.svelte](../../../src/client/components/BrainQuerySettingsSection.svelte)` — handle picker, three default policy templates from `[brainQueryPolicyTemplates.ts](../../../src/client/lib/brainQueryPolicyTemplates.ts)`, structured logs (owner/asker views).
- **API:** `[brainQuery.ts](../../../src/server/routes/brainQuery.ts)` — grants CRUD, `POST /` query, `GET /log?role=` (unchanged).
- **Chat `@` (people + wiki):** `[AgentInput.svelte](../../../src/client/components/AgentInput.svelte)` shows mixed suggestions; `[UserMessageContent.svelte](../../../src/client/components/agent-conversation/UserMessageContent.svelte)` renders distinct chips for people vs wiki documents in `[ChatMessageRow.svelte](../../../src/client/components/agent-conversation/ChatMessageRow.svelte)`. Persisted `msg.content` stays plain text.
- **Handle suggest API (shared):** `GET /api/account/workspace-handles?q=…` — used by `[WikiShareDialog.svelte](../../../src/client/components/WikiShareDialog.svelte)`, the Hub grant row, and the chat composer through `[workspaceHandleSuggest.ts](../../../src/client/lib/workspaceHandleSuggest.ts)`.

---

## Chat composer: `@` mentions for **people** (handles) vs **wiki documents**

Brain-to-brain flows (“ask `@donna` …”) should feel as natural as wiki `@` mentions. Today the composer only knows **files**; we need **workspace handles** in the same `@` affordance **without** looking like a document reference.

### Requirements

1. **Autocomplete** — When the user types `@`, offer **both** (or a clear mode):
  - **Wiki documents** — current behavior: paths, `[WikiFileName](../../../src/client/components/WikiFileName.svelte)` in the dropdown.
  - **People / handles** — results from `**/api/account/workspace-handles`**, show `@handle` + display name (mirror share-dialog rows).
2. **Disambiguation grammar (implemented)** — Single `@` prefix; the **path shape** of the trailing token decides type. Documents always end in `.md` and contain a `/`; people are bare handles. Tokens that don’t fit either shape stay as plain text.

   | Shape | Renders as | Examples |
   |---|---|---|
   | `@me/<path>.md` | Vault wiki document | `@me/projects/launch.md` |
   | `@<handle>/<path>.md` | Shared wiki document | `@donna/notes/idea.md` |
   | `@<handle>` (no `/`, no `.md`) | Person chip | `@donna`, `@alex-r` |
   | `@<handle>/...` without `.md` | Plain text (not a mention) | `@team/2026` |

   - Handles follow the workspace rule: 3–32 chars, lowercase alphanumerics with optional internal hyphens (no leading/trailing hyphen). Mixed case is accepted on input and lowercased for matching.
   - The composer reinforces this with a **sectioned dropdown** (“People” vs “Documents”), so users see the type before they pick. The transcript renders with the visual treatment in §3 below.
   - Source of truth: `[userMessageMentions.ts](../../../src/client/lib/userMessageMentions.ts)` (parser, used by `[UserMessageContent.svelte](../../../src/client/components/agent-conversation/UserMessageContent.svelte)`).
3. **Rendering — must differ from wiki mentions** — In the **transcript** (and ideally inline while typing if we ever rich-compose user text):
  - **Wiki:** keep **file-style** presentation (path segments, doc semantics, open-wiki affordance later).
  - **Person / handle:** distinct **chip** or badge (e.g. different background, “person” affordance — icon or label pattern — **not** `WikiFileName` styling so users never confuse “I tagged a file” with “I tagged a collaborator’s brain”).
4. **Accessibility** — Listbox sections for mixed results; screen reader labels that say “person” vs “wiki document”.

### Engineering notes (as shipped)

- `[AgentInput.svelte](../../../src/client/components/AgentInput.svelte)` shows **mixed** suggestions: people from `GET /api/account/workspace-handles` + wiki paths, in two sections (`People`, `Documents`), with shared keyboard nav.
- Handle-suggestion logic was extracted to `[workspaceHandleSuggest.ts](../../../src/client/lib/workspaceHandleSuggest.ts)` and reused by `[WikiShareDialog.svelte](../../../src/client/components/WikiShareDialog.svelte)` and the new Hub grant-creation row in `[BrainQuerySettingsSection.svelte](../../../src/client/components/BrainQuerySettingsSection.svelte)`.
- User-message rendering is unchanged on disk (still plain text); display only goes through `[UserMessageContent.svelte](../../../src/client/components/agent-conversation/UserMessageContent.svelte)`, which calls the parser above. Wiki mentions reuse `WikiFileName`; person mentions render as a distinct chip with an `AtSign` glyph so they cannot be confused with file references.
- The agent-side NL parsing for `ask_brain` is unchanged; person tokens are normalized to lowercase handles in the parser so a downstream lookup stays straightforward if/when we wire it up.

---

## UX goals (non-exhaustive)

1. **Grants**
  - Clear “who can ask my brain” vs “whose brain I can ask” (owner-centric vs asker-centric framing).
  - **Grant creation** flow aligned with wiki-share handle picker patterns where it helps, but **not** conflated with “share files.”
  - **Revoke** obvious and immediate; copy explains what stops working.
2. **Policy editor**
  - **Spike 1 ([access-policy spikes](../../architecture/brain-to-brain-access-policy.md#implementation-spikes-ui-first-then-policy-depth)):** per-connection **privacy policy** textarea with **reset to default** and short **inline guidance** (what the filter pass sees). Optional: **starter templates** (load curated strings only), read-only **filter preview**, **human-confirmed** LLM suggestions on save — still **one stored blob** per grant.
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
- Component tests for new flows per [component-testing.md](../../component-testing.md).
- If UX research suggests **split panels** (grants vs log), keep routes **simple** (`/hub` sections) unless deep-linking is required.

---

## Exit criteria (as closed)

Epic closure and **follow-up data model** are documented in [architecture/brain-to-brain-access-policy.md](../../architecture/brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure). Historically targeted:

- A user can **grant**, **edit policy**, **revoke**, and **read logs** without confusion, in line with the goals above.
- Copy and layout reflect **honest security framing** (filter limits, no over-promise).
- Hub policy UX aligns with **Spike 1** (textarea + optional helpers); **Spikes 3–4** (fragments, hard predicates) remain future work.
- **Chat:** `@` workspace handles from the composer; **person mentions** render distinctly from **wiki document** mentions (grammar in **Disambiguation grammar** above).
- Optional follow-on: notifications, export, cross-instance.