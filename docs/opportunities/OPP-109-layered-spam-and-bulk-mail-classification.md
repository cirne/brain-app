# OPP-109: Layered spam and bulk-mail classification

**Status:** Open  
**See also:** [archived OPP-084](archive/OPP-084-adaptive-rules-learning-agent.md) (adaptive rules / learning agent — historical), [OPP-085](OPP-085-rule-action-extensions.md) (rule actions), **`src/server/ripmail/inbox.ts`** (deterministic `inbox()`), **`src/server/ripmail/rules/default_rules.v3.json`**.

---

## Problem

Braintunnel’s **inbox pipeline** today is largely **deterministic regex / search-shaped rules** over indexed mail. That catches some patterns well but behaves like **Swiss cheese** against modern spam and graymail: authentication failures, reputation, URL tricks, and statistical signals are either weak or absent, while obvious junk still reaches the surfaced inbox.

Operators and users compare this to **Gmail-scale** filtering and expect comparable *quality*, not parity with Google’s unreplicable cross-user graph—only **much better-than-regex** discrimination with **acceptable local cost**.

---

## Context: what large providers do (approximately)

Providers do **not** rely on a single technique such as **k-means clustering** as the headline. Public descriptions and anti-abuse practice converge on **layered pipelines**:

1. **Authentication and policy** — SPF, DKIM, DMARC (especially **alignment** between From and authenticated domain). Failures are cheap, high-value signals before content.
2. **Reputation** — Sending IP/domain reputation, abuse reporting, temporal patterns; at scale, **cross-mailbox** prevalence (hard to replicate purely locally).
3. **Supervised classifiers** — Historically Naive Bayes / logistic regression on tokenized text; at scale, boosted trees and neural models on subjects, snippets, URLs, headers. Primary framing is **classification**, not clustering.
4. **Heuristic rules** — SpamAssassin-style cumulative scores for headers, MIME oddities, obfuscated links, mismatched display names.
5. **User feedback** — “Spam” / “not spam” retrains models continuously (core to why Gmail feels adaptive).

---

## Goal

Improve **spam vs ham** and **bulk vs personal** separation for Braintunnel’s indexed mail **without** requiring an **LLM call per message** for baseline behavior.

Concrete outcomes:

- **Fewer obvious false negatives** (spam in the primary surfaced set).
- **Predictable latency** — cheap tiers run on sync / inbox scan; expensive or stochastic steps optional.
- **Explainability** — decisions remain inspectable enough for inbox debug (rules, scores, reasons), aligned with deterministic-first culture in **`inbox()`**.

---

## Proposed directions (fast tiers first)

These are ordered by typical **signal-per-microsecond**. Multiple can compose into a **cumulative score** (SpamAssassin-style) rather than replacing rules wholesale.

| Tier | Technique | Role |
|------|-----------|------|
| **0** | **Auth signals** — SPF/DKIM/DMARC disposition and alignment where headers exist | Strong prior before body tokenization |
| **1** | **URL / domain features** — Parsed links; punycode; redirect chains; hyphenation; mismatch of visible vs href text | Cheap content signal without full LLM |
| **2** | **Optional DNS reputation** — Curated URIBL/SBL-style lookups | Higher maintenance / false-positive risk; likely opt-in |
| **3** | **Heuristic header + structural rules** — List-Id, Precedence, Reply-To vs From mismatches, HTML-only tiny body, etc. | Extends today's JSON rules vocabulary |
| **4** | **Small local supervised model** — Linear model or compact classifier on **subject + snippet** (+ optional hashed tokens), trained from **user labels** | Sub-millisecond-ish inference; personalizes without cloud |
| **5** | **Bayesian / logistic baseline** — Classic per-token probabilities from local labeled mail | Fallback if richer ML is undesirable |

**Separate from spam:** treat **marketing / transactional bulk** as a **distribution** bucket (newsletters, receipts) via headers + recurring senders + unsubscribe signals—not only “spam.”

---

## LLM tier (optional, bounded)

Reserve **agent / LLM** usage for:

- **Uncertainty band only** — e.g. mid-score messages where rules and the small model disagree.
- **Offline assists** — suggest new rules or explain “why flagged” after the fact (`list_inbox` diagnostics, tooling).
- **Explicit user-triggered** actions — never on the critical path for indexing unless product explicitly opts in.

This composes cleanly with **[archived OPP-084](archive/OPP-084-adaptive-rules-learning-agent.md)** if that direction is revived: learning **produces** tiers 0–4 artifacts; the LLM does not score every arrival.

---

## Non-goals (for this opportunity)

- **Parity with Gmail’s hidden global signals** — not realistic for a local-first indexer without a backing reputation service owned by Braintunnel.
- **Blocking at SMTP/IMAP edge** — in scope only if product later exposes server-side rejection; Braintunnel today is index + surfaced inbox.
- **Guaranteed zero false positives** — reputation and blocklists trade sensitivity for FP rate; defaults should stay conservative.

---

## Implementation notes

- **Hook point:** **`inbox()`** in **`src/server/ripmail/inbox.ts`** and rule packs under **`src/server/ripmail/rules/`** (today **`default_rules.v3.json`**).
- **Data:** Persisted **`inbox_decisions`** / scan metadata already support fingerprinting rule sets; extending with **score breakdowns** or **signal tags** (JSON) aids Hub debug and regression tests (**`src/server/ripmail/ripmail.test.ts`**).
- **Privacy / offline:** Prefer **DNS or local lookups** with clear policy; avoid shipping raw message bodies to third parties unless product explicitly enables it.

---

## Success criteria (draft)

- **Measurable:** reduction in “obvious spam” in default surfaced inbox on a labeled fixture set or internal corpus; no large regression on ham.
- **Performance:** deterministic path remains fast enough for batch inbox scan(s) documented in **`AGENTS.md`** expectations.
- **Operability:** user or dev can answer “why hidden?” from stored decision metadata.
