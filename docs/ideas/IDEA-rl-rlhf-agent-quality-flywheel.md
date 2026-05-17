# Idea: RL / RLHF and a product-native quality flywheel

**Status:** Backlog — concept and sequencing only; no dedicated opportunity or training pipeline yet.

**Related:** [VISION.md](../VISION.md) (compounding personalization), [STRATEGY.md](../STRATEGY.md) (narrow wedge, trust), [AGENTS.md](../../AGENTS.md) (JSONL agent evals), user skill **`/feedback`** ([`assets/user-skills/feedback/SKILL.md`](../../assets/user-skills/feedback/SKILL.md)), [`process-feedback` skill](../../.cursor/skills/process-feedback/SKILL.md) (operator triage), [`src/server/lib/feedback/feedbackIssues.ts`](../../src/server/lib/feedback/feedbackIssues.ts), composer **suggested reply** chips (`ComposerContextBar` + `QuickReplyChoice`).

---

## Summary

**Reinforcement learning** for LLMs (including **RLHF**-style preference optimization) means updating the policy—the model or agent—toward **rewards** or **human preferences** over trajectories (tokens, tool calls, outcomes). For Braintunnel, the actionable bet is not “stand up full RL training on day one,” but **instrumentation + evaluation + a small number of well-defined signals** so we can later **filter exportable training or eval data** without confusing users or violating trust.

This doc captures **how we think about RL-ish improvement**, **where signals come from in the product**, and **why `/feedback` is the primary high-signal funnel** for human-labeled failures, with **outcome metrics** (e.g. mail draft → send with few iterations) as strong implicit positives.

---

## Intuition: what “RL for LLMs” usually means

- **Actions:** Tokens and, in agentic mode, **tool calls** (search mail, read wiki, draft email, etc.).
- **Environment:** User messages, tool results, errors, and **task outcomes** (draft sent, event created, eval task passed).
- **Reward / preference:** Rarely a perfect per-token score. Common patterns:
  - **Human preferences** — rank two answers; train a reward model or use direct preference optimization (**DPO** / variants).
  - **Outcome and verifier rewards** — JSON validity, eval pass/fail, “schema OK,” gold QA sets.
  - **Process shaping** — bonuses for correct tool choice or penalties for loops (when measurable).
  - **Routing / bandits** — choose model or prompt variant to optimize cost/latency subject to quality (lightweight “RL”).

**Implication:** The expensive part is **defining what “better” is** and **logging enough structure** (turn id, tools, outcomes) to connect behavior to labels—not the word “RL” on a slide.

---

## What we would want to improve in Braintunnel

| Dimension | Rough goal |
|-----------|-------------|
| **Grounding** | Fewer wrong or invented claims when mail/wiki/calendar are available; appropriate tool use before answering. |
| **Agent reliability** | Correct tool sequence, no pointless loops, stop when done. |
| **Token / cost efficiency** | Shorter turns when depth is not needed—without harming quality (needs a quality constraint or verifier). |
| **Compose → send** | First (or early) draft good enough that users **send** without a long repair loop. |

Frontier chat models are already **preference-tuned** by their vendors; our leverage is **product-specific failure modes** (grounding, tools, privacy, B2B review flows) and **our** logged trajectories—not rebuilding generic RLHF from scratch unless a slice is clearly blocked without it.

---

## Signal taxonomy (explicit vs implicit)

### Explicit, high-context negative (and some positives)

- **`/feedback` → `product_feedback`** — User-consented, structured reports with **transcript and tool/trace context** when the agent misbehaves. This is the right **primary insertion point** for “this answer path was wrong” data: one funnel for **bugs, features, and agent quality**; a **downstream processor** can **categorize** or **filter** items that are suitable for eval mining or future preference learning versus pure product bugs.
- **Avoid** framing this as “training” in user copy; it is **filing feedback** with honest redaction and confirm-before-submit.

### Implicit positives and process negatives (especially mail compose)

- **Strong positive proxy:** **`send_draft` / draft actually sent** (or equivalent “committed” outcome in the product)—a real user action that validates usefulness.
- **Process / quality proxy:** **Iterations between first draft and send** — each user request to revise (“shorter,” “more formal,” “add X”) is **negative signal on the initial draft** even if the session ends in success. **Abandonment** (draft never sent) is ambiguous and should not be treated as a hard negative without more context.

These outcome signals are **programmatic**, aligned with user value, and complementary to sparse `/feedback` reports.

### Suggested reply chips (composer)

- **Weak positive:** User taps a **suggested reply** (`QuickReplyChoice`) — interest in that trajectory; stronger if they **edit before send**.
- **Weak negative for ranking suggestions:** User ignores chips and types something else — useful for **which suggestions to show**, not necessarily for full-model RL.
- **UX note:** Mixing **“this isn’t working”** into the same strip as forward suggestions muddies the mental model; **per-message** or **`/feedback`** is a better home for penalty-style signals than competing chip siblings.

---

## Sequencing: early vs later

**Early (high leverage, low ceremony):**

- Keep **agent JSONL evals** and extend **metrics** where cheap: pass rate, tool errors, tokens per resolved task, **draft iteration count**, send rate.
- Ensure feedback issues can carry **stable metadata** when we need it (e.g. session/turn references, issue subtype)—**without** storing unnecessary plaintext.
- Optional: **deep-link** from a discreet UI control into **`/feedback`** with a prefilled template (“Assistant response problem”) for users who will not invoke the slash skill cold.

**Later (after clear failure modes and volume / policy clarity):**

- **Offline export** of categorized episodes for DPO/preference pairs or internal fine-tuning—**only** with governance, redaction, and consent posture consistent with [STRATEGY.md](../STRATEGY.md) trust themes.
- **Custom post-training** only when **prompting + routing + eval-driven prompt/tool changes** stop moving the metrics that matter.

---

## Backend “processor” concept

A batch or streaming job (or human triage step) could:

- Classify feedback and episodes into **product bug**, **tooling**, **model grounding**, **UX confusion**, **policy/safety**, etc.
- Emit a **small, redacted corpus** for ML (e.g. JSONL with tool traces and labels) **without** treating every ticket as training gold.
- Stay aligned with **[`docs/feedback-processed/registry.md`](../feedback-processed/registry.md)** and operator workflow—**RL slice is a consumer**, not a replacement for BUG/OPP triage.

---

## Caveats

- **Volume and bias:** `/feedback` is **sparse** and **skewed toward frustration**—excellent for **hard negatives** and **clustering**; poor as the only distribution for training.
- **Attribution:** Multi-step revision might reflect **micromanaging style** vs model quality; **cohorts and session-level features** help.
- **Tool vs prose:** Failures may be **integration errors**, not LLM errors—link **tool outcomes** to the same episode.
- **Privacy:** Prefer **counts, timestamps, ids, and redacted summaries** over full bodies for automated pipelines.

---

## Open questions

- What **minimum metadata** on feedback issues and compose episodes gives the best **replayability** for evals without increasing PII surface?
- Do we want **explicit issue subtype** at submit time (one tap) vs **classifier-only** downstream?
- When B2B **review/approve** is in the loop, how do we treat **owner-edited drafts** as partial credit or separate signal?

---

## Next steps (when this graduates toward work)

1. Add or extend **OPP-*** when we commit to **metrics + export shape** or **classifier/triage** automation.
2. Tie **compose iteration** and **send** events to **session/turn identity** in whatever logging layer is canonical for agent traces.
3. Revisit **suggestion-chip telemetry** only as needed for **ranking**—keep **quality critique** on **`/feedback`** or message-level affordances.
