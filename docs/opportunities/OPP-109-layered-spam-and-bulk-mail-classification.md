# OPP-109: Inbox triage — algorithmic pre-filter + batched LLM (refresh scope)

**Status:** Open  
**See also:** [archived OPP-084](archive/OPP-084-adaptive-rules-learning-agent.md) (adaptive rules / learning agent), [OPP-085](OPP-085-rule-action-extensions.md) (rule actions), **`src/server/ripmail/inbox.ts`** (`inbox()` + `loadRulesFile()`), **`src/server/ripmail/rules/default_rules.v4.json`** (bundled default pack + metadata).

---

## Problem

Deterministic **regex / search-shaped** rules and coarse heuristics miss nuance for modern **graymail**, while **aggressive defaults** (broad category matches, substring `from` rules, etc.) create **false negatives** for real mail. Operators still want **explainable** triage (`notify` / `inform` / `ignore`) and **predictable cost**.

---

## Direction (revised)

Ripmail **refresh** already pays a large fixed cost (OAuth / IMAP connect, often on the order of **~10s**). On top of that, **incremental** polls usually yield a **small** set of new or re-scored messages. Use that window for **one batched LLM call per refresh** (no tools) that returns **strict JSON** mapping candidate message ids to triage — cheap relative to sync when **N** is modest.

**Do not** send full message bodies: use **selected headers** (e.g. `From`, `Subject`, `List-Id`, `Precedence`, auth result lines when indexed) plus a **short preview** (~**200** characters of plain/snippet) per message. That keeps tokens down and latency predictable.

### Tiered pipeline

1. **Cheap algorithmic pass first (quick wins)** — runs on the same candidate set, no LLM:
   - **SPF / DKIM / DMARC** signals when available in stored headers (`Authentication-Results`, etc.).
   - **Structural / list mail** hints: `List-Id`, `List-Unsubscribe`, `Precedence`, obvious mailer-daemon / postmaster patterns.
   - **Optional:** conservative URL/domain checks (punycode, display-name vs link host mismatch); **optional** DNS blocklists only with clear policy (latency + false positives).
   - **Narrow bundled `rules.json`** for rules that stay deterministic (see default pack + metadata).

2. **Batched LLM triage** — **one** structured call per refresh batch:
   - Model: **small / fast** profile (e.g. fast tier env).
   - Input: compact rows (ids + headers subset + ~200 char preview).
   - Output: JSON only (validated), e.g. `{ "decisions": [ { "messageId": "…", "action": "notify|inform|ignore" } ] }` — **no tool calls**.
   - Persist results with **`decisionSource`** / provenance so Hub and `list_inbox` stay debuggable.

3. **Large batches** — When a run would exceed a **budget** (too many candidates, e.g. first sync or huge backlog):
   - **Skip** the LLM tier for that pass **or** process only the **tail** (newest first) within the cap.
   - Rely on tier 1 + existing **`inbox()`** fallback heuristics for the remainder; document the behavior.

### `rules.json` and deploy resets

Bundled defaults live in **`default_rules.v4.json`** with **`metadata`**:

- **`bundledRulesetRevision`** — monotonic; bump when shipping a new default pack.
- **`overwriteExistingTenantsWithBundledDefault`** — when **true**, any tenant whose persisted `lastAppliedBundledRulesetRevision` is **less than** the bundled revision gets **`rules.json` replaced** on the next `loadRulesFile()` (early-stage product: ship aggressive resets without migration scripts). When **absent / false**, new defaults apply only when **`rules.json` is missing** or unreadable.

User/API saves **stamp** `lastAppliedBundledRulesetRevision` so custom rules are not mistaken for stale pack state.

---

## Non-goals

- **Gmail-scale global graph** — not required; local-first quality target is “**much better than regex**,” not parity with Google’s cross-user signals.
- **LLM on every message for all time** — cap by refresh scope and batch size; **no** tools in the triage call.
- **Guaranteed zero false positives** for optional DNS / blocklist tiers.

---

## Success criteria (draft)

- Fewer **obvious** false positives from **bloated default rules**; narrow deterministic pack + **reset metadata** as needed.
- Refresh path: **bounded** LLM cost (batch JSON once, short previews); **graceful degrade** when candidate count ≫ threshold.
- Decisions remain **inspectable** (`decisionSource`, rule id when deterministic path wins).
