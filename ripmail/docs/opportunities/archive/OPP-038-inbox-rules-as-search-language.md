# OPP-038: Inbox Rules as Search Language — One Expression, Same Semantics as `ripmail search`

**Status:** Archived — mostly implemented. **Archived:** 2026-04-10. `rules.json` v3 search rules and validation shipped; doc kept as design record.

**Shipped (in-tree).** **Created:** 2026-04-05. **Tags:** inbox, rules, search, determinism, agents, cli

**Related:** [ADR-028](../ARCHITECTURE.md#adr-028-deterministic-inbox--typed-rules-no-llm-triage) (deterministic inbox), [OPP-037 archived](OPP-037-typed-inbox-rules-eval-style.md) (typed regex rules — current shipped shape), [OPP-035 archived](OPP-035-inbox-personal-context-layer.md) (personal context vs policy), [OPP-017](../OPP-017-code-health-idiomatic-patterns.md) (search filter semantics)

---

## Problem (historical)

Before v3, inbox rules were **`kind: "regex"`** objects with separate optional fields (`fromPattern`, `subjectPattern`, `bodyPattern`, …) combined only by **AND**. They did not model recipient/`To`/`Cc`, and did not express **OR** between subject and body without splitting into multiple rules. **Superseded** by **`kind: "search"`** + **`query`** (this document remains the design record).

Agents and users already learn `**ripmail search`** query syntax (`from:`, `to:`, `subject:`, `after:`/`before:`, FTS remainder with `OR`/`AND`, and the special `from:a OR to:b` form that sets **OR between header filters** while the FTS clause **AND**s with that group). Re‑inventing a parallel boolean language in JSON duplicates concepts and drifts semantics.

**Goal:** Replace the regex-rule schema with **one string per rule**: the **same language** as search. **No backward compatibility** with the old `regex` shape — bump `rules.json` version, update CLI/`ripmail rules`, docs, and defaults in one clean break (per repo early-dev policy).

---

## Proposal

### Rule shape (illustrative)

Each rule is a **policy** attached to a **search expression** that either matches a message or not (within the inbox candidate set):

```json
{
  "version": 3,
  "rules": [
    {
      "id": "zoom-assets",
      "action": "ignore",
      "query": "from:no-reply@zoom.us meeting OR summary"
    },
    {
      "id": "self-mail-ripmail",
      "action": "inform",
      "query": "from:lewiscirne@gmail.com OR to:lewiscirne@gmail.com zoom"
    }
  ]
}
```

- `**query`:** identical grammar and semantics to `**ripmail search "<query>"`** (including inline operators parsed from the string — see `src/search/query_parse.rs` and `src/search/filter.rs`).
- **Precedence:** **list order, short-circuit** — see [Decisions](#decisions) below (first matching rule **claims** the message; lower rules are not evaluated for it).

### Decisions

**State name — `pending`**

- Use `**pending**` for “not yet assigned by the ordered rule pass.”
- **Do not** call this “uncategorized” — that collides with **message category** (social, promotions, provider labels, etc.). `**pending`** is explicitly **rule-triage state**, not content classification.

**Index-first, shared predicate with search**

- Messages are **inserted into SQLite + FTS** (existing sync/index path) **before** rule evaluation.
- Do **not** duplicate FTS/LIKE/`filter_or` logic in a second in-memory implementation. Reuse the **same** parsed query → `**WHERE`** (and FTS `MATCH`) as `ripmail search`, scoped with `**m.message_id = ?`** (or equivalent), i.e. “does this row satisfy the same predicate as a full search?” — not “run `ripmail search` and scan the whole corpus.”

**Short-circuit top → bottom**

- Rules run **from highest priority (first in the array) to lowest (last)**.
- Only messages still `**pending`** are candidates for the **next** rule.
- The **first** rule whose `query` matches a `**pending`** message assigns that message’s action (and recorded **winning rule id**) and removes it from `**pending`** for subsequent rules.
- Effect: an **if / else-if** chain over the rule list — **one winning rule per message** on the hot path (unlike evaluating every rule and unioning matches).

**Re-run / reorder**

- If the user **reorders rules** or **edits** them, recompute by resetting relevant rows to `**pending`** and re-running the pass (or full inbox re-triage — exact scope TBD). New mail only: simplest story is “insert → **pending** → pass.”

**Debugging**

- Hot path exposes `**winningRuleId`** (or equivalent). Listing **all** rules that *would* have matched is optional (**explain** / dry-run tooling), not required for classification.

### Why this wins

- **One mental model:** “If `ripmail search '<query>'` would return this message, the rule applies.”
- **Expressive:** Example patterns that are awkward or impossible with flat regex ANDs become one string (see examples below).
- **Agent-friendly:** Agents can prototype with `ripmail search ...`, then paste the working string into `rules.json`.

### Tradeoffs and risks


| Topic            | Note                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FTS vs regex** | Search uses **FTS5** on indexed columns, not regex over arbitrary fields. That is a **semantic change** vs current body/subject regex — intentional for alignment with search.                                                                                                                                                                                                     |
| **Performance**  | **Bar is low vs alternatives:** any plausible local SQLite/FTS pass beats an **LLM operating on many messages** (latency, cost, determinism). **Short-circuit** and batch `UPDATE … WHERE pending AND (<predicate>)` are nice wins, not a gating research problem — a simpler or heavier first implementation is acceptable if correctness and shared search semantics come first. |
| **Parity**       | Inbox candidates must expose the same **logical** fields search uses (`from`, `to`/`cc`, `subject`, `body_text`, `date`, category). `InboxCandidate` already carries `to_addresses`; search SQL already joins FTS + `messages`.                                                                                                                                                    |
| **Category**     | `ripmail search` applies default category filtering unless `--include-all`. Rules should document whether they use **search-default** or **inbox-default** category scope — align with `ripmail inbox` expectations.                                                                                                                                                                   |


### Implementation sketch (non-committal)

1. New `UserRule` variant, e.g. `kind: "search"` with `{ id, action, query }` (exact JSON shape TBD).
2. Persist triage state: messages eligible for the rule pass start as `**pending`**; each rule step applies the shared search predicate only to `**pending`** rows, then marks matches with **action + winning rule id**.
3. `parse_search_query` + `SearchOptions` → same SQL fragment as search, plus `message_id` / `pending` filter — **not** a second semantics layer.
4. `ripmail rules validate` — compile query + optional sample against DB.
5. `rules_fingerprint` includes normalized `query` strings in order.
6. Remove or replace `kind: "regex"` paths in `src/inbox/rule_match.rs` and CLI add/edit.

---

## Examples validated on real data (`ripmail search`)

Commands were run on this machine’s indexed mailbox (**~26k messages** as of the check below). Counts illustrate that the language is already usable for policy-style expressions.

**Index snapshot (for reproducibility):**

```bash
ripmail stats --json
# messageCount: 26645 (example run 2026-04-05)
```

### 1. Provider + keyword OR in body/subject (FTS)

Notify or ignore Zoom “meeting assets” noise while matching either **meeting** or **summary** in the full-text index:

```bash
ripmail search 'from:no-reply@zoom.us meeting OR summary' --json
# totalMatched: 192
```

### 2. Participant OR (from / to) AND keyword

Mail where you are on **either** side of the conversation **and** the thread mentions “zoom” (FTS):

```bash
ripmail search 'from:lewiscirne@gmail.com OR to:lewiscirne@gmail.com zoom' --json
# totalMatched: 1 (tight match on this mailbox)
```

This is the pattern that is **not** expressible as a single current regex rule.

### 3. Date window AND sender

Recent mail from a specific automated sender:

```bash
ripmail search 'after:30d from:no-reply@zoom.us' --json
# Returns recent Zoom notifications (subset of all Zoom mail)
```

### 4. Subject filter AND from domain (header AND)

Receipt-style subjects from Stripe-powered senders:

```bash
ripmail search 'subject:receipt from:stripe' --json
# totalMatched: 87
```

### 5. OR only between header filters (no FTS terms)

Broad “anything involving this address as from or to” (uses `filter_or` between `from`/`to` predicates — see `parse_search_query` tests):

```bash
ripmail search 'from:cirne OR to:cirne' --json
# totalMatched: 11951 (large — illustrates LIKE-based from/to matching)
```

---

## Acceptance criteria (implemented)

- `rules.json` v3 documents **`query`**-based rules only; no `regex` kind.
- `ripmail inbox` uses the same search SQL/FTS path as `ripmail search` per rule `query`, scoped to inbox candidates and **`rule_triage = pending`** for short-circuit assignment (see `src/search/rule_membership.rs`, `src/inbox/rule_match.rs`).
- Rule pass: **`pending`** → ordered **`UPDATE`** per rule → **`assigned`** + **`winning_rule_id`**; one winner per message on the hot path; rows exist in SQLite + FTS before evaluation.
- `ripmail rules validate` compiles queries; `ripmail rules validate --sample` runs DB counts when `data/ripmail.db` exists; `ripmail rules add/edit` use **`--query`**.
- Integration/unit tests: search parity helpers, OPP-style synthetic fixtures, short-circuit and preview-superseded coverage.
- **`skills/ripmail/references/INBOX-CUSTOMIZATION.md`** updated for v3 search rules and triage semantics.

---

## Open questions

1. Should a rule’s `query` imply `**--include-all`** categories by default, or follow `**ripmail search**` defaults? (Recommendation: match **search** defaults and add an explicit flag in rules later if needed, e.g. `"includeAllCategories": true`.)
2. Do we expose `**--category`** parity inside the string, or only via a separate JSON field for v1?
3. Preview: should `ripmail rules feedback` / impact preview run the **same** SQL path as `ripmail search` for fidelity?

